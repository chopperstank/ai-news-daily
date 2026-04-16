/**
 * 数据库同步模块
 * 将 AI 处理后的新闻数据批量推送到远程 API，写入 MySQL
 */

const axios = require('axios');

// 同步超时配置（单次请求最长 30 秒）
const SYNC_TIMEOUT = 30000;
// 重试次数
const MAX_RETRIES = 3;
// 重试间隔（毫秒）
const RETRY_DELAY = 2000;

/**
 * 将日报数据同步到远程数据库
 * @param {Object} options
 * @param {Array} options.items - 新闻条目列表
 * @param {string} options.highlights - AI 生成的今日要点
 * @param {string} options.date - 日期 YYYY-MM-DD
 * @returns {Promise<Object>} 同步结果 { success, data }
 */
async function syncToDatabase({ items, highlights, date }) {
  const apiUrl = process.env.NEWS_API_URL || 'https://github.stank.top/api/news/batch';
  const apiToken = process.env.NEWS_API_TOKEN;

  // 检查配置
  if (!apiUrl || !apiToken) {
    console.log('⏭️  [同步] 未配置 NEWS_API_URL 或 NEWS_API_TOKEN，跳过数据库同步');
    return { success: false, skipped: true, reason: '未配置同步参数' };
  }

  if (!items || items.length === 0) {
    console.log('⏭️  [同步] 无新闻数据，跳过同步');
    return { success: false, skipped: true, reason: '无数据' };
  }

  console.log(`\n📡 [同步] 开始同步 ${items.length} 条新闻到数据库...`);
  console.log(`   API: ${apiUrl.replace(/\/\/[^/]+@/, '//***@')}`); // 隐藏凭证

  const payload = {
    date,
    highlights: highlights || '',
    items: items.map((item) => ({
      title: item.title || '',
      category: item.category || 'AI/ML',
      summary: item.summary || item.description || '',
      content: item.content || item.description || '',
      source: item.source || '',
      source_url: item.link || item.url || '',
      tags: item.tags || '',
      is_featured: item.is_featured ? 1 : 0,
    })),
  };

  // 带重试的请求
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(apiUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'User-Agent': 'AI-News-Daily-Bot/1.0',
        },
        timeout: SYNC_TIMEOUT,
      });

      const result = response.data;

      if (result.success) {
        const d = result.data;
        console.log(`✅ [同步] 完成！新增 ${d.inserted} / 更新 ${d.updated} / 跳过 ${d.skipped}`);
        return { success: true, ...d };
      } else {
        console.error(`❌ [同步] API 返回失败: ${result.message}`);
        lastError = new Error(result.message);
      }
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const statusText = error.response?.statusText;

      if (status === 401 || status === 403) {
        // 认证失败，不需要重试
        console.error(`❌ [同步] 认证失败 (${status}): 请检查 NEWS_API_TOKEN 是否正确`);
        return { success: false, error: `认证失败: ${statusText}` };
      }

      if (status === 400) {
        // 数据校验失败，不需要重试
        const msg = error.response?.data?.message || statusText;
        console.error(`❌ [同步] 数据校验失败: ${msg}`);
        return { success: false, error: `数据校验失败: ${msg}` };
      }

      // 网络错误或服务端错误，重试
      console.warn(`⚠️  [同步] 第 ${attempt}/${MAX_RETRIES} 次失败: ${error.message}`);

      if (attempt < MAX_RETRIES) {
        console.log(`   ${RETRY_DELAY / 1000}s 后重试...`);
        await sleep(RETRY_DELAY * attempt); // 递增延迟
      }
    }
  }

  console.error(`❌ [同步] ${MAX_RETRIES} 次重试后仍失败: ${lastError.message}`);
  return { success: false, error: lastError.message };
}

/**
 * 延时函数
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { syncToDatabase };
