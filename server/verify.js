#!/usr/bin/env node
/**
 * AI News Daily - 独立验证脚本
 *
 * 在服务器上独立运行，无需 app.js，验证：
 *   1. 数据库连接是否正常
 *   2. news_buffer / news_daily_log 表是否存在且结构兼容
 *   3. 写入一条测试数据并清理
 *   4. Token 配置是否齐全
 *   5. （可选）模拟完整 API 调用
 *
 * 用法：
 *   cd /www/wwwroot/nodejs/github_news   # 进入服务器项目目录
 *   node verify.js                        # 基础验证
 *   node verify.js --full                 # 完整验证（含模拟 API 调用）
 *
 * 零依赖：纯 Node.js 内置模块 + mysql2（项目已有）
 * 不需要 dotenv / axios 等包
 */

// ─── 手动加载 .env（不依赖 dotenv 包）──────────────────────────
const fs = require('fs');
const path = require('path');
(function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
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

const mysql = require('mysql2/promise');

// ─── 简易 HTTP 请求（替代 axios，使用 Node.js 内置 https）──────
const https = require('https');
const http = require('http');
function httpPost(url, data, headers, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const urlObj = new URL(url);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
      timeout: timeoutMs,
    };
    const req = lib.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.write(body);
    req.end();
  });
}

// ─── 颜色输出 ───────────────────────────────────────────────
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

const OK   = c.green('  ✓');
const FAIL = c.red('  ✗');
const WARN = c.yellow('  ⚠');
const INFO = c.cyan('  →');

let passCount = 0;
let failCount = 0;

function pass(msg) { console.log(`${OK} ${msg}`); passCount++; }
function fail(msg) { console.log(`${FAIL} ${msg}`); failCount++; }
function warn(msg) { console.log(`${WARN} ${msg}`); }
function info(msg) { console.log(`${INFO} ${c.dim(msg)}`); }

// ─── 数据库配置（从当前 .env 读取，与 app.js 保持一致） ──────
const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER     || 'ai_nav',
  password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
  database: process.env.DB_NAME     || 'ai_nav',
  charset:  'utf8mb4',
  connectTimeout: 10000,
};

// ─── 主流程 ───────────────────────────────────────────────────
async function main() {
  const fullMode = process.argv.includes('--full');

  console.log('');
  console.log(c.bold('═══════════════════════════════════════════'));
  console.log(c.bold('  🔍 AI News Daily - 服务器验证脚本'));
  console.log(c.bold('═══════════════════════════════════════════'));
  console.log('');

  // ─── 步骤 1：环境变量检查 ─────────────────────────────────────
  console.log(c.bold('【1】环境变量检查'));

  const requiredEnvs = ['DB_HOST', 'DB_USER', 'DB_NAME', 'NEWS_API_TOKEN'];
  const optionalEnvs = ['DB_PORT', 'DB_PASSWORD', 'DB_PASS'];

  for (const key of requiredEnvs) {
    if (process.env[key]) {
      pass(`${key} = ${key.includes('PASSWORD') || key.includes('TOKEN') ? '***' : process.env[key]}`);
    } else {
      fail(`${key} 未配置（在 .env 中添加）`);
    }
  }
  for (const key of optionalEnvs) {
    if (process.env[key]) {
      info(`${key} = ${key.includes('PASSWORD') ? '***' : process.env[key]} （可选，已配置）`);
    }
  }
  console.log('');

  // ─── 步骤 2：数据库连接 ───────────────────────────────────────
  console.log(c.bold('【2】数据库连接测试'));
  info(`连接 ${DB_CONFIG.user}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);

  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    pass('数据库连接成功');

    // ping
    await conn.query('SELECT 1');
    pass('数据库响应正常');

    // 字符集
    const [[{ Value: charset }]] = await conn.query("SHOW VARIABLES LIKE 'character_set_database'");
    if (charset.startsWith('utf8')) {
      pass(`字符集正常: ${charset}`);
    } else {
      warn(`字符集为 ${charset}，建议使用 utf8mb4`);
    }

  } catch (err) {
    fail(`数据库连接失败: ${err.message}`);
    console.log('');
    console.log(c.red('  无法继续，请先修复数据库连接问题。'));
    console.log(c.dim('  常见原因：'));
    console.log(c.dim('    - .env 中 DB_HOST / DB_USER / DB_PASSWORD / DB_NAME 配置错误'));
    console.log(c.dim('    - MySQL 服务未启动：sudo systemctl status mysql'));
    console.log(c.dim('    - 用户权限不足：GRANT ALL ON ai_nav.* TO ai_nav@localhost;'));
    process.exit(1);
  }
  console.log('');

  // ─── 步骤 3：表结构检查 ───────────────────────────────────────
  console.log(c.bold('【3】表结构检查'));

  // 3a. news_buffer
  try {
    const [[row]] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='news_buffer'",
      [DB_CONFIG.database]
    );
    if (row.cnt > 0) {
      pass('news_buffer 表存在');
      // 检查关键字段
      const [cols] = await conn.query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='news_buffer'",
        [DB_CONFIG.database]
      );
      const colNames = cols.map(r => r.COLUMN_NAME);
      const requiredCols = ['title', 'category', 'summary', 'source_url', 'is_featured', 'status', 'synced'];
      const missingCols = requiredCols.filter(c => !colNames.includes(c));
      if (missingCols.length === 0) {
        pass(`news_buffer 必要字段均存在: ${requiredCols.join(', ')}`);
      } else {
        fail(`news_buffer 缺少字段: ${missingCols.join(', ')}`);
        warn('建议：ALTER TABLE news_buffer ADD COLUMN ...');
      }

      // 检查 source_url 唯一索引
      const [indexes] = await conn.query(
        "SHOW INDEX FROM news_buffer WHERE Column_name='source_url' AND Non_unique=0"
      );
      if (indexes.length > 0) {
        pass('news_buffer.source_url 唯一索引存在（防重复）');
      } else {
        warn('news_buffer.source_url 无唯一索引，重复数据将多次写入');
        info('修复方法：ALTER TABLE news_buffer ADD UNIQUE INDEX uk_source_url (source_url(255));');
      }

      // 检查 publish_date 字段
      if (colNames.includes('publish_date')) {
        pass('news_buffer.publish_date 字段存在');
      } else {
        warn('news_buffer 缺少 publish_date 字段（用于日期归档，建议添加）');
        info('修复方法：ALTER TABLE news_buffer ADD COLUMN publish_date DATE NULL AFTER synced;');
      }

      // 数据量
      const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM news_buffer');
      info(`当前 news_buffer 表共 ${total} 条数据`);

    } else {
      fail('news_buffer 表不存在');
      warn('请先创建 news_buffer 表，或将表名修改为你的实际新闻表名');
    }
  } catch (err) {
    fail(`检查 news_buffer 失败: ${err.message}`);
  }

  // 3b. news_daily_log
  try {
    const [[row]] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='news_daily_log'",
      [DB_CONFIG.database]
    );
    if (row.cnt > 0) {
      pass('news_daily_log 表存在');
    } else {
      warn('news_daily_log 表不存在，将自动跳过日志记录');
      info('创建方法：mysql -u root -p ai_nav < database/init.sql');
    }
  } catch (err) {
    fail(`检查 news_daily_log 失败: ${err.message}`);
  }

  // 3c. tool_categories（可选）
  try {
    const [[row]] = await conn.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.VIEWS WHERE TABLE_SCHEMA=? AND TABLE_NAME='tool_categories'",
      [DB_CONFIG.database]
    );
    if (row.cnt > 0) {
      pass('tool_categories 视图存在');
    } else {
      info('tool_categories 视图不存在（可选，不影响运行）');
    }
  } catch (err) {
    info(`检查 tool_categories: ${err.message}`);
  }
  console.log('');

  // ─── 步骤 4：写入测试 ─────────────────────────────────────────
  console.log(c.bold('【4】数据写入测试'));

  const TEST_URL = `https://verify-test.ai-news-daily.local/test-${Date.now()}`;
  let testInserted = false;

  try {
    // 检查 publish_date 字段是否存在来决定 SQL
    const [cols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='news_buffer' AND COLUMN_NAME='publish_date'",
      [DB_CONFIG.database]
    );
    const hasPublishDate = cols.length > 0;

    const sql = hasPublishDate
      ? `INSERT INTO news_buffer (title, category, summary, content, source, source_url, tags, is_featured, status, synced, publish_date)
         VALUES ('【验证测试】AI News Daily 写入测试', 'AI/ML', '这是一条验证测试数据，会在测试后自动删除', '', '验证脚本', ?, '测试,验证', 0, 0, 0, CURDATE())
         ON DUPLICATE KEY UPDATE title = VALUES(title)`
      : `INSERT INTO news_buffer (title, category, summary, content, source, source_url, tags, is_featured, status, synced)
         VALUES ('【验证测试】AI News Daily 写入测试', 'AI/ML', '这是一条验证测试数据，会在测试后自动删除', '', '验证脚本', ?, '测试,验证', 0, 0, 0)
         ON DUPLICATE KEY UPDATE title = VALUES(title)`;

    const [result] = await conn.query(sql, [TEST_URL]);
    if (result.affectedRows >= 1) {
      pass('测试数据写入成功');
      testInserted = true;
    }
  } catch (err) {
    fail(`写入测试失败: ${err.message}`);
    if (err.message.includes("Unknown column")) {
      warn(`表字段不匹配，请对照 database/init.sql 补充缺失字段`);
    }
  }

  // 清理测试数据
  if (testInserted) {
    try {
      await conn.query("DELETE FROM news_buffer WHERE source_url = ?", [TEST_URL]);
      pass('测试数据已清理');
    } catch (err) {
      warn(`测试数据清理失败（可手动删除）: ${err.message}`);
    }
  }
  console.log('');

  // ─── 步骤 5：Token 配置检查 ───────────────────────────────────
  console.log(c.bold('【5】Token 配置检查'));

  const token = process.env.NEWS_API_TOKEN;
  if (!token) {
    fail('NEWS_API_TOKEN 未配置');
    info('在服务器 .env 中添加：NEWS_API_TOKEN=<随机字符串>');
    info('生成方法：openssl rand -hex 32');
  } else if (token.length < 16) {
    warn(`NEWS_API_TOKEN 长度仅 ${token.length} 位，建议 32 位以上`);
  } else {
    pass(`NEWS_API_TOKEN 已配置（长度 ${token.length} 位）`);
  }
  console.log('');

  // ─── 步骤 6：模拟完整 API 调用（--full 模式） ───────────────────
  if (fullMode) {
    console.log(c.bold('【6】模拟 API 调用（--full 模式）'));

    const apiUrl = process.env.NEWS_API_URL || `http://127.0.0.1:${process.env.PORT || 9966}/api/news/batch`;
    info(`目标地址: ${apiUrl}`);

    try {
      const testUrl = `https://verify-full.ai-news-daily.local/test-${Date.now()}`;
      const resp = await httpPost(apiUrl, {
        date: new Date().toISOString().slice(0, 10),
        highlights: '验证脚本生成的测试要点',
        items: [{
          title: '【全流程测试】AI News Daily API 验证',
          category: 'AI/ML',
          summary: '这是一条全流程验证数据，测试完成后会自动删除',
          content: '',
          source: '验证脚本',
          source_url: testUrl,
          tags: '测试,验证',
          is_featured: 0,
        }],
      }, { 'Authorization': `Bearer ${token}` });

      if (resp.status === 200 && resp.data.success) {
        pass(`API 调用成功: 新增 ${resp.data.data.inserted}，更新 ${resp.data.data.updated}`);
        await conn.query(
          "DELETE FROM news_buffer WHERE source_url LIKE 'https://verify-full.ai-news-daily.local/%'"
        );
        pass('全流程测试数据已清理');
      } else if (resp.status === 403) {
        fail(`Token 鉴权失败（403），请检查 NEWS_API_TOKEN 是否与服务器 .env 一致`);
      } else {
        fail(`API 返回 ${resp.status}: ${JSON.stringify(resp.data)}`);
      }
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED')) {
        warn(`服务未启动（连接被拒绝），请先 pm2 start 后再运行 --full 模式`);
      } else {
        fail(`API 调用失败: ${err.message}`);
      }
    }
    console.log('');
  }

  // ─── 总结 ─────────────────────────────────────────────────────
  await conn.end();

  console.log(c.bold('═══════════════════════════════════════════'));
  if (failCount === 0) {
    console.log(c.green(c.bold(`  ✅ 验证通过！${passCount} 项全部正常`)));
    if (!fullMode) {
      console.log(c.dim('  提示：运行 node verify.js --full 可验证完整 API 调用'));
    }
  } else {
    console.log(c.red(c.bold(`  ❌ 验证未通过：${failCount} 项失败，${passCount} 项通过`)));
    console.log(c.dim('  请根据上方提示逐项修复后重新验证'));
  }
  console.log(c.bold('═══════════════════════════════════════════'));
  console.log('');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(c.red('验证脚本异常退出:'), err.message);
  process.exit(1);
});
