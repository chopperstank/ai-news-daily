/**
 * 爬虫数据采集器
 * 用于没有 RSS/API 的网站，使用 cheerio 解析 HTML
 */

const axios = require('axios');
const cheerio = require('cheerio');

const axiosInstance = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
  },
  decompress: true,
});

/**
 * GitHub Trending 采集
 * 获取今日热门开源项目
 * @param {number} maxItems - 最大采集条目数
 * @returns {Array} 新闻条目列表
 */
async function collectGitHubTrending(maxItems = 10) {
  try {
    console.log('📡 [Crawler] 采集中: GitHub Trending');
    const response = await axiosInstance.get('https://github.com/trending');
    const $ = cheerio.load(response.data);

    const items = [];
    $('article.Box-row').slice(0, maxItems).each((_, el) => {
      const $el = $(el);
      const $repo = $el.find('h2 a');
      const repoName = $repo.text().replace(/\s+/g, '').trim();
      const repoUrl = `https://github.com${$repo.attr('href')}`;

      // 描述
      const description = $el.find('p').text().trim() || '无描述';

      // 语言
      const language = $el.find('[itemprop="programmingLanguage"]').text().trim() || '';

      // 今日星标数
      const starsToday = $el
        .find('.float-sm-right')
        .text()
        .match(/(\d[\d,]*)\s*stars\s*today/i);
      const stars = starsToday ? starsToday[1] : '0';

      // 总星标数
      const totalStars = $el
        .find('.Link--muted.d-inline-block.mr-3')
        .text()
        .trim()
        .replace(/,/g, '') || '0';

      items.push({
        title: `${repoName} ⭐ ${stars}/day`,
        link: repoUrl,
        description: `[${language}] ${description}`.trim(),
        pubDate: new Date().toISOString(),
        source: 'GitHub Trending',
        category: 'DevTools',
        type: 'crawler',
        score: parseInt(stars.replace(/,/g, '')) || 0,
        language,
        totalStars: parseInt(totalStars) || 0,
      });
    });

    console.log(`✅ [Crawler] GitHub Trending: 采集 ${items.length} 条`);
    return items;
  } catch (error) {
    console.error(`❌ [Crawler] GitHub Trending 采集失败: ${error.message}`);
    return [];
  }
}

/**
 * 根据数据源名称路由到对应的爬虫函数
 * @param {Object} source - 数据源配置
 * @param {number} maxItems - 最大采集条目数
 * @returns {Array} 新闻条目列表
 */
async function collect(source, maxItems = 10) {
  switch (source.name) {
    case 'GitHub Trending':
      return collectGitHubTrending(maxItems);
    default:
      console.warn(`⚠️ [Crawler] 未知爬虫源: ${source.name}，跳过`);
      return [];
  }
}

module.exports = { collect };
