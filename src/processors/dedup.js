/**
 * 数据去重模块
 * 基于新闻 URL 去除跨源重复
 */

/**
 * 对新闻条目按 URL 去重
 * @param {Array} items - 新闻条目列表
 * @returns {Array} 去重后的新闻条目
 */
function dedupByUrl(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    // 标准化 URL（去除末尾斜杠、追踪参数）
    const normalizedUrl = normalizeUrl(item.link);
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    result.push(item);
  }

  const removed = items.length - result.length;
  if (removed > 0) {
    console.log(`🔄 [去重] 去除 ${removed} 条重复新闻，剩余 ${result.length} 条`);
  }

  return result;
}

/**
 * 标准化 URL
 */
function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    // 去除追踪参数
    ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'source'].forEach((param) =>
      u.searchParams.delete(param)
    );
    // 去除末尾斜杠
    let normalized = u.toString().replace(/\/+$/, '');
    // HN 去重：条目 ID 去掉
    normalized = normalized.replace(/\?id=\d+$/, '');
    return normalized;
  } catch {
    return url;
  }
}

/**
 * 按标题相似度去重（可选）
 * 简单实现：标题包含关系视为重复
 */
function dedupByTitle(items) {
  const result = [];
  const titles = result.map((i) => i.title.toLowerCase());

  for (const item of items) {
    const title = item.title.toLowerCase();
    const isDuplicate = titles.some((t) => t.includes(title) || title.includes(t));
    if (!isDuplicate) {
      result.push(item);
      titles.push(title);
    }
  }

  const removed = items.length - result.length;
  if (removed > 0) {
    console.log(`🔄 [标题去重] 去除 ${removed} 条相似标题`);
  }

  return result;
}

module.exports = { dedupByUrl, dedupByTitle };
