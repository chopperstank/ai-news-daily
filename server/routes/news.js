/**
 * AI News Daily - 新闻 API 路由
 *
 * 接口列表：
 *   POST   /api/news/batch       批量写入新闻（需 Bearer Token）
 *   GET    /api/news/health      健康检查（无需鉴权）
 *   GET    /api/news             查询新闻列表（分页、分类过滤）
 *   GET    /api/news/daily/:date 查询某日新闻
 *   GET    /api/news/categories  获取分类列表
 *   GET    /api/news/logs        获取采集日志
 */

const express = require('express');
const router = express.Router();

// ==================== 常量配置 ====================
const MAX_ITEMS_PER_REQUEST = 100;
const MAX_TITLE_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_CONTENT_LENGTH = 65535;
const MAX_TAGS_LENGTH = 500;

const VALID_CATEGORIES = [
  '热门推荐', '大模型', 'AI写作', 'AI绘画', 'AI视频', 'AI聊天',
  'AI编程', 'AI音频', 'AI办公', 'AI产品', 'AI学习资料',
  'AI/ML', '开发工具', 'IDE', '开源', '云计算',
];

// 分类 Emoji 映射
const CATEGORY_EMOJIS = {
  '热门推荐': '🔥', '大模型': '🧠', 'AI写作': '✍️', 'AI绘画': '🎨', 'AI视频': '🎬',
  'AI聊天': '💬', 'AI编程': '👨‍💻', 'AI音频': '🎧', 'AI办公': '📊', 'AI产品': '📦',
  'AI学习资料': '📚', 'AI/ML': '🤖', '开发工具': '🛠️', 'IDE': '💻', '开源': '📬', '云计算': '☁️',
};

// ==================== 工具函数 ====================

/** 获取数据库连接池 */
function getPool(req) {
  return req.pool || (req.app && req.app.get('pool')) || null;
}

/** 参数校验：分页 */
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size) || parseInt(query.pageSize) || 20));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

// ==================== 中间件：Token 鉴权 ====================
function authMiddleware(req, res, next) {
  const token = process.env.NEWS_API_TOKEN;
  if (!token) {
    console.error('[News API] ❌ 环境变量 NEWS_API_TOKEN 未配置');
    return res.status(500).json({ success: false, message: '服务端未配置 API Token' });
  }

  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '缺少 Authorization: Bearer <token> 请求头' });
  }

  if (authHeader.slice(7) !== token) {
    return res.status(403).json({ success: false, message: 'Token 无效' });
  }

  next();
}

// ==================== 中间件：数据校验 ====================
function validateMiddleware(req, res, next) {
  const { date, items } = req.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: 'date 格式错误，应为 YYYY-MM-DD' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'items 不能为空数组' });
  }
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    return res.status(400).json({ success: false, message: `单次最多写入 ${MAX_ITEMS_PER_REQUEST} 条` });
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.title || typeof item.title !== 'string' || !item.title.trim()) {
      return res.status(400).json({ success: false, message: `items[${i}].title 不能为空` });
    }
    if (!item.source_url || typeof item.source_url !== 'string') {
      return res.status(400).json({ success: false, message: `items[${i}].source_url 不能为空` });
    }
    // 不合法分类自动降级，不拦截
    if (item.category && !VALID_CATEGORIES.includes(item.category)) {
      items[i].category = 'AI/ML';
    }
  }

  next();
}

// ==================== POST /batch - 批量写入 ====================
router.post('/batch', authMiddleware, validateMiddleware, async (req, res) => {
  const { date, highlights, items } = req.body;
  const pool = getPool(req);
  if (!pool) {
    return res.status(500).json({ success: false, message: '数据库连接未就绪' });
  }

  let conn;
  let inserted = 0, updated = 0, skipped = 0;
  const errorItems = [];

  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    for (const item of items) {
      try {
        const [result] = await conn.query(
          `INSERT INTO news_buffer (
            title, category, summary, content, source, source_url,
            tags, is_featured, status, synced, publish_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
          ON DUPLICATE KEY UPDATE
            title       = VALUES(title),
            category    = VALUES(category),
            summary     = VALUES(summary),
            content     = VALUES(content),
            source      = VALUES(source),
            tags        = VALUES(tags),
            is_featured = VALUES(is_featured),
            updated_at  = CURRENT_TIMESTAMP`,
          [
            item.title.trim().slice(0, MAX_TITLE_LENGTH),
            item.category || 'AI/ML',
            (item.summary || '').slice(0, MAX_SUMMARY_LENGTH),
            (item.content || '').slice(0, MAX_CONTENT_LENGTH),
            (item.source || '').slice(0, 100),
            item.source_url.slice(0, 1000),
            (item.tags || '').slice(0, MAX_TAGS_LENGTH),
            item.is_featured ? 1 : 0,
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

    // 写入采集日志
    const logStatus = errorItems.length === 0 ? 'success'
      : errorItems.length < items.length ? 'partial' : 'failed';

    await conn.query(
      `INSERT INTO news_daily_log (
        publish_date, total_collected, total_deduped,
        total_inserted, total_updated, total_skipped,
        highlights, status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_collected = VALUES(total_collected),
        total_deduped   = VALUES(total_deduped),
        total_inserted  = VALUES(total_inserted),
        total_updated   = VALUES(total_updated),
        total_skipped   = VALUES(total_skipped),
        highlights      = VALUES(highlights),
        status          = VALUES(status),
        error_message   = VALUES(error_message),
        created_at      = CURRENT_TIMESTAMP`,
      [
        date,
        items.length, items.length,
        inserted, updated, skipped,
        (highlights || '').slice(0, 65535),
        logStatus,
        errorItems.slice(0, 5).map(e => e.error).join('; '),
      ]
    );

    await conn.commit();

    console.log(`[News API] ✅ ${date}: 新增 ${inserted}  更新 ${updated}  跳过 ${skipped}`);

    res.json({
      success: true,
      data: { date, total: items.length, inserted, updated, skipped, status: logStatus },
    });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error('[News API] ❌ 事务失败:', err.message);
    res.status(500).json({
      success: false,
      message: '数据库写入失败',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  } finally {
    if (conn) conn.release();
  }
});

// ==================== GET / - 查询新闻列表 ====================
router.get('/', async (req, res) => {
  const pool = getPool(req);
  if (!pool) {
    return res.status(500).json({ success: false, message: '数据库连接未就绪' });
  }

  try {
    const { page, pageSize, offset } = parsePagination(req.query);
    const { category, source, keyword, is_featured, status: queryStatus } = req.query;

    // 构建条件
    const conditions = [];
    const params = [];

    if (category && VALID_CATEGORIES.includes(category)) {
      conditions.push('category = ?');
      params.push(category);
    }
    if (source) {
      conditions.push('source = ?');
      params.push(source);
    }
    if (keyword) {
      conditions.push('(title LIKE ? OR summary LIKE ?)');
      const kw = `%${keyword}%`;
      params.push(kw, kw);
    }
    if (is_featured === '1' || is_featured === 1) {
      conditions.push('is_featured = 1');
    }
    if (queryStatus !== undefined) {
      conditions.push('status = ?');
      params.push(parseInt(queryStatus));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 查询总数
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM news_buffer ${where}`, params);

    // 查询数据
    const [rows] = await pool.query(
      `SELECT id, title, category, summary, source, source_url, tags,
              is_featured, status, synced, publish_date, created_at, updated_at
       FROM news_buffer ${where}
       ORDER BY is_featured DESC, publish_date DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    // 给每条数据加上 emoji
    const data = rows.map(row => ({
      ...row,
      emoji: CATEGORY_EMOJIS[row.category] || '📰',
    }));

    res.json({
      success: true,
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });

  } catch (err) {
    console.error('[News API] ❌ 查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// ==================== GET /daily/:date - 查询某日新闻 ====================
router.get('/daily/:date', async (req, res) => {
  const pool = getPool(req);
  if (!pool) {
    return res.status(500).json({ success: false, message: '数据库连接未就绪' });
  }

  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: 'date 格式错误，应为 YYYY-MM-DD' });
  }

  try {
    // 查询该日新闻
    const [news] = await pool.query(
      `SELECT id, title, category, summary, content, source, source_url, tags,
              is_featured, status, publish_date, created_at
       FROM news_buffer
       WHERE publish_date = ?
       ORDER BY is_featured DESC, id DESC`,
      [date]
    );

    // 查询该日日志
    const [logs] = await pool.query(
      'SELECT * FROM news_daily_log WHERE publish_date = ?',
      [date]
    );

    // 按分类分组
    const grouped = {};
    for (const item of news) {
      const cat = item.category || 'AI/ML';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({ ...item, emoji: CATEGORY_EMOJIS[cat] || '📰' });
    }

    res.json({
      success: true,
      data: {
        date,
        highlights: logs.length > 0 ? logs[0].highlights : '',
        log: logs.length > 0 ? logs[0] : null,
        categories: grouped,
        total: news.length,
      },
    });

  } catch (err) {
    console.error('[News API] ❌ 查询失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// ==================== GET /categories - 获取分类列表 ====================
router.get('/categories', async (req, res) => {
  const pool = getPool(req);

  try {
    // 优先查 tool_categories 视图
    let categories = [];
    if (pool) {
      try {
        const [rows] = await pool.query('SELECT * FROM tool_categories ORDER BY sort ASC');
        categories = rows;
      } catch {
        // tool_categories 不存在，使用内置列表
      }
    }

    if (categories.length === 0) {
      categories = VALID_CATEGORIES.map((name, i) => ({
        name,
        emoji: CATEGORY_EMOJIS[name] || '📰',
        sort: i + 1,
      }));
    }

    // 查询每个分类的新闻数量
    let counts = {};
    if (pool) {
      try {
        const [rows] = await pool.query(
          'SELECT category, COUNT(*) AS count FROM news_buffer WHERE status = 1 GROUP BY category'
        );
        counts = {};
        for (const row of rows) counts[row.category] = row.count;
      } catch { /* 忽略 */ }
    }

    res.json({
      success: true,
      data: categories.map(cat => ({
        ...cat,
        count: counts[cat.name] || 0,
      })),
    });

  } catch (err) {
    res.json({ success: true, data: VALID_CATEGORIES.map(name => ({ name, emoji: CATEGORY_EMOJIS[name], count: 0 })) });
  }
});

// ==================== GET /logs - 获取采集日志 ====================
router.get('/logs', async (req, res) => {
  const pool = getPool(req);
  if (!pool) {
    return res.status(500).json({ success: false, message: '数据库连接未就绪' });
  }

  try {
    const { page, pageSize, offset } = parsePagination(req.query);

    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM news_daily_log');
    const [rows] = await pool.query(
      `SELECT id, publish_date, total_collected, total_deduped,
              total_inserted, total_updated, total_skipped,
              highlights, status, error_message, created_at
       FROM news_daily_log
       ORDER BY publish_date DESC
       LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );

    res.json({
      success: true,
      data: rows,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });

  } catch (err) {
    console.error('[News API] ❌ 查询日志失败:', err.message);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// ==================== GET /health - 健康检查 ====================
router.get('/health', async (req, res) => {
  const pool = getPool(req);
  let dbOk = false;
  let dbMsg = '';

  if (pool) {
    try {
      const conn = await pool.getConnection();
      await conn.query('SELECT 1');
      conn.release();
      dbOk = true;
    } catch (err) {
      dbMsg = err.message;
    }
  } else {
    dbMsg = 'pool 未挂载';
  }

  res.json({
    success: true,
    api: 'News API is running',
    db: dbOk ? 'connected' : `error: ${dbMsg}`,
    token_configured: !!process.env.NEWS_API_TOKEN,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
