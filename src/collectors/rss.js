/**
 * RSS 数据采集器
 * 支持解析 RSS/Atom XML 格式
 * 使用 axios 获取内容，支持重试和代理
 */

const axios = require('axios');
const Parser = require('rss-parser');

const rssParser = new Parser({
  customFields: {
    item: ['description', 'content:encoded'],
  },
});

/**
 * 修复 XML 中的非法 & 字符
 * 有些 RSS 源（如 Hashnode）会在 XML 属性或内容中直接写 & 而不是 &amp;
 * 这会导致 XML 解析器报 "Invalid character in entity name" 错误
 */
function fixMalformedXml(xml) {
  // 将 & 后面不是合法 XML 实体的情况替换为 &amp;
  // 合法实体：&amp; &lt; &gt; &quot; &apos; &#数字; &#x十六进制;
  return xml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
}

const axiosInstance = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
  },
});

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

/**
 * 带重试的 RSS 采集
 * @param {Object} source - 数据源配置
 * @param {number} maxItems - 最大采集条目数
 * @returns {Array} 新闻条目列表
 */
async function collect(source, maxItems = 10) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `📡 [RSS] ${attempt > 0 ? `重试(${attempt}) ` : ''}采集中: ${source.name} (${source.url})`
      );

      // 使用 axios 获取内容（比 rss-parser 内置请求更可靠）
      const response = await axiosInstance.get(source.url, {
        responseType: 'text',
        timeout: 20000,
      });

      const rawXml = response.data;

      // 预处理：修复 XML 中的非法 & 字符（部分 RSS 源如 Hashnode 存在此问题）
      const xml = fixMalformedXml(rawXml);

      // 使用 rss-parser 解析 XML
      const feed = await rssParser.parseString(xml);

      const items = (feed.items || []).slice(0, maxItems).map((item) => ({
        title: item.title || '无标题',
        link: item.link || '',
        description: stripHtml(item.contentSnippet || item.content || item.summary || ''),
        pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
        source: source.name,
        category: source.category,
        type: 'rss',
      }));

      console.log(`✅ [RSS] ${source.name}: 采集 ${items.length} 条`);
      return items;
    } catch (error) {
      const isRetryable =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.response?.status >= 500 ||
        error.response?.status === 429;

      if (attempt === MAX_RETRIES || !isRetryable) {
        console.error(`❌ [RSS] ${source.name} 采集失败: ${error.message}`);
        return [];
      }

      const delay = RETRY_DELAY * (attempt + 1);
      console.warn(`⚠️ [RSS] ${source.name}: ${delay}ms 后重试...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return [];
}

/**
 * 去除 HTML 标签
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
    .slice(0, 500);
}

module.exports = { collect };
