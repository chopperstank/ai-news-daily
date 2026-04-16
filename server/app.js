#!/usr/bin/env node
/**
 * AI News Daily - 后端服务入口（纯 Node.js 内置模块，零外部依赖）
 *
 * 只依赖：mysql2（服务器项目已有）+ Node.js 内置模块
 * 不需要：dotenv、express、cors、helmet
 *
 * 启动：
 *   node app.js
 *   pm2 start ecosystem.config.js
 */

// ─── 手动加载 .env（不依赖 dotenv 包）──────────────────────────
const fs = require('fs');
const path = require('path');
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
})();

const http = require('http');
const https = require('https');
const mysql = require('mysql2/promise');
const url = require('url');

// ==================== 配置 ====================
const PORT = parseInt(process.env.PORT) || 3389;
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
  charset: process.env.DB_CHARSET || 'utf8mb4',
};

// ==================== 合法分类枚举 ====================
const VALID_CATEGORIES = [
  '热门推荐', '大模型', 'AI写作', 'AI绘画', 'AI视频', 'AI聊天',
  'AI编程', 'AI音频', 'AI办公', 'AI产品', 'AI学习资料',
  'AI/ML', '开发工具', 'IDE', '开源', '云计算',
];

// ==================== 工具函数 ====================
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { success: false, message });
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function escapeLike(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

function parsePagination(queryStr) {
  const params = new URLSearchParams(queryStr || '');
  const page = Math.max(1, parseInt(params.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(params.get('page_size')) || 20));
  const offset = (page - 1) * pageSize;
  const category = params.get('category') || '';
  const keyword = params.get('keyword') || '';
  const featured = params.get('featured');
  const status = params.get('status');
  return { page, pageSize, offset, category, keyword, featured, status };
}

// ==================== 路由处理函数 ====================

// --- 健康检查 ---
async function handleHealth(req, res) {
  let dbOk = false;
  try {
    await pool.execute('SELECT 1');
    dbOk = true;
  } catch {}
  sendJSON(res, 200, {
    success: true,
    message: 'AI News Daily API is running',
    timestamp: new Date().toISOString(),
    database: dbOk ? 'connected' : 'disconnected',
  });
}

// --- 批量写入 ---
async function handleBatchWrite(req, res) {
  // Token 鉴权
  const token = getBearerToken(req);
  if (!token) return sendError(res, 401, '缺少 Authorization 头');
  if (!process.env.NEWS_API_TOKEN) return sendError(res, 500, '服务端未配置 API Token');
  if (token !== process.env.NEWS_API_TOKEN) return sendError(res, 403, 'Token 无效');

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return sendError(res, 400, '请求体 JSON 格式错误');
  }

  const { date, highlights, items } = body;

  // 日期校验
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return sendError(res, 400, 'date 格式错误，应为 YYYY-MM-DD');
  }

  // items 校验
  if (!Array.isArray(items) || items.length === 0) {
    return sendError(res, 400, 'items 不能为空');
  }
  if (items.length > 100) {
    return sendError(res, 400, '单次最多写入 100 条');
  }

  // 逐条校验
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.title || typeof item.title !== 'string') {
      return sendError(res, 400, `items[${i}].title 不能为空`);
    }
    if (!item.source_url || typeof item.source_url !== 'string') {
      return sendError(res, 400, `items[${i}].source_url 不能为空`);
    }
    if (item.title.length > 500) {
      return sendError(res, 400, `items[${i}].title 超长（最大500字符）`);
    }
  }

  let inserted = 0, updated = 0, skipped = 0;
  const errorItems = [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    for (const item of items) {
      try {
        const [result] = await conn.execute(
          `INSERT INTO news_buffer (
            title, category, summary, content, source, source_url,
            tags, is_featured, status, synced, publish_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            title = VALUES(title),
            category = VALUES(category),
            summary = VALUES(summary),
            content = VALUES(content),
            source = VALUES(source),
            tags = VALUES(tags),
            is_featured = VALUES(is_featured),
            updated_at = CURRENT_TIMESTAMP`,
          [
            (item.title || '').slice(0, 500),
            VALID_CATEGORIES.includes(item.category) ? item.category : 'AI/ML',
            (item.summary || '').slice(0, 2000),
            item.content || '',
            (item.source || '').slice(0, 100),
            item.source_url,
            (item.tags || '').slice(0, 500),
            item.is_featured ? 1 : 0,
            1,
            0,
            date,
          ]
        );
        if (result.affectedRows === 1) inserted++;
        else if (result.affectedRows === 2) updated++;
        else skipped++;
      } catch (err) {
        skipped++;
        errorItems.push({ title: item.title, error: err.message });
      }
    }

    // 记录采集日志
    const status = errorItems.length === 0 ? 'success'
      : (errorItems.length < items.length ? 'partial' : 'failed');
    const errorMsg = errorItems.slice(0, 5).map(e => e.error).join('; ');

    await conn.execute(
      `INSERT INTO news_daily_log (
        publish_date, total_collected, total_deduped, total_inserted,
        total_updated, total_skipped, highlights, status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_collected = VALUES(total_collected),
        total_deduped = VALUES(total_deduped),
        total_inserted = VALUES(total_inserted),
        total_updated = VALUES(total_updated),
        total_skipped = VALUES(total_skipped),
        highlights = VALUES(highlights),
        status = VALUES(status),
        error_message = VALUES(error_message)`,
      [date, items.length, items.length, inserted, updated, skipped, highlights || '', status, errorMsg]
    );

    await conn.commit();

    console.log(`[API] ${date}: +${inserted} ~${updated} -${skipped} (${status})`);
    sendJSON(res, 200, { success: true, data: { date, total: items.length, inserted, updated, skipped, status } });

  } catch (error) {
    await conn.rollback();
    console.error('[API] 事务失败:', error.message);
    sendError(res, 500, '数据库写入失败');
  } finally {
    conn.release();
  }
}

// --- 新闻列表 ---
async function handleNewsList(req, res) {
  const { page, pageSize, offset, category, keyword, featured, status } = parsePagination(req.url);

  let where = 'WHERE 1=1';
  const params = [];

  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  if (keyword) {
    where += ' AND (title LIKE ? OR summary LIKE ?)';
    const kw = `%${escapeLike(keyword)}%`;
    params.push(kw, kw);
  }
  if (featured === '1') {
    where += ' AND is_featured = 1';
  }
  if (status !== null && status !== undefined && status !== '') {
    where += ' AND status = ?';
    params.push(parseInt(status));
  } else {
    where += ' AND status = 1';
  }

  const [[countRow]] = await pool.execute(`SELECT COUNT(*) as total FROM news_buffer ${where}`, params);
  const [rows] = await pool.execute(
    `SELECT id, title, category, summary, source, source_url, tags,
            is_featured, status, synced, publish_date,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') as created_at,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i') as updated_at
     FROM news_buffer ${where}
     ORDER BY is_featured DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  sendJSON(res, 200, {
    success: true,
    data: {
      list: rows,
      pagination: {
        page, page_size: pageSize, total: countRow.total,
        total_pages: Math.ceil(countRow.total / pageSize),
      },
    },
  });
}

// --- 某日新闻 ---
async function handleNewsByDate(req, res, dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return sendError(res, 400, '日期格式错误，应为 YYYY-MM-DD');
  }

  const [rows] = await pool.execute(
    `SELECT id, title, category, summary, source, source_url, tags,
            is_featured, publish_date, created_at
     FROM news_buffer
     WHERE publish_date = ? AND status = 1
     ORDER BY is_featured DESC, category, id`,
    [dateStr]
  );

  const [logRows] = await pool.execute(
    `SELECT * FROM news_daily_log WHERE publish_date = ?`,
    [dateStr]
  );

  // 按分类分组
  const grouped = {};
  for (const row of rows) {
    const cat = row.category || 'AI/ML';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(row);
  }

  sendJSON(res, 200, {
    success: true,
    data: {
      date: dateStr,
      total: rows.length,
      highlights: logRows[0]?.highlights || '',
      categories: grouped,
      log: logRows[0] || null,
    },
  });
}

// --- 分类列表 ---
async function handleCategories(req, res) {
  const [rows] = await pool.execute(
    `SELECT category, COUNT(*) as count
     FROM news_buffer WHERE status = 1
     GROUP BY category
     ORDER BY count DESC`
  );

  const allCategories = VALID_CATEGORIES.map(name => {
    const found = rows.find(r => r.category === name);
    return { name, count: found ? found.count : 0 };
  });

  sendJSON(res, 200, { success: true, data: allCategories });
}

// --- 采集日志 ---
async function handleLogs(req, res) {
  const params = new URLSearchParams(req.url?.split('?')[1] || '');
  const limit = Math.min(30, Math.max(1, parseInt(params.get('limit')) || 10));

  const [rows] = await pool.execute(
    `SELECT * FROM news_daily_log ORDER BY publish_date DESC LIMIT ?`,
    [limit]
  );

  sendJSON(res, 200, { success: true, data: rows });
}

// ==================== 路由匹配 ====================
async function routeHandler(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  // CORS 预检
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  try {
    // GET /api/news/health
    if (method === 'GET' && pathname === '/api/news/health') {
      return await handleHealth(req, res);
    }

    // POST /api/news/batch
    if (method === 'POST' && pathname === '/api/news/batch') {
      return await handleBatchWrite(req, res);
    }

    // GET /api/news
    if (method === 'GET' && pathname === '/api/news') {
      return await handleNewsList(req, res);
    }

    // GET /api/news/daily/:date
    if (method === 'GET' && pathname.startsWith('/api/news/daily/')) {
      const dateStr = pathname.replace('/api/news/daily/', '');
      return await handleNewsByDate(req, res, dateStr);
    }

    // GET /api/news/categories
    if (method === 'GET' && pathname === '/api/news/categories') {
      return await handleCategories(req, res);
    }

    // GET /api/news/logs
    if (method === 'GET' && pathname === '/api/news/logs') {
      return await handleLogs(req, res);
    }

    // 404
    sendError(res, 404, '接口不存在');

  } catch (error) {
    console.error('[API] 未捕获错误:', error);
    sendError(res, 500, '服务器内部错误');
  }
}

// ==================== 启动服务 ====================
let pool;

async function start() {
  // 创建数据库连接池
  pool = mysql.createPool(DB_CONFIG);

  // 测试连接
  try {
    const conn = await pool.getConnection();
    console.log('✅ 数据库连接成功');
    conn.release();
  } catch (err) {
    console.error('❌ 数据库连接失败:', err.message);
    process.exit(1);
  }

  // 创建 HTTP 服务
  const server = http.createServer(routeHandler);

  server.listen(PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('  🤖 AI News Daily API');
    console.log(`  🌐 http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════════');
    console.log('');
    console.log('  接口列表：');
    console.log('    GET  /api/news/health      健康检查');
    console.log('    POST /api/news/batch        批量写入（需 Token）');
    console.log('    GET  /api/news              新闻列表');
    console.log('    GET  /api/news/daily/:date  某日新闻');
    console.log('    GET  /api/news/categories   分类列表');
    console.log('    GET  /api/news/logs         采集日志');
    console.log('');
  });

  // 优雅关闭
  const shutdown = async (signal) => {
    console.log(`\n收到 ${signal}，正在关闭...`);
    server.close();
    if (pool) await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
