/**
 * 采集器统一入口
 * 根据数据源类型分发到对应的采集器
 */

const rssCollector = require('./rss');
const apiCollector = require('./api');
const crawlerCollector = require('./crawler');

/**
 * 采集单个数据源
 * @param {Object} source - 数据源配置 { name, type, url, category, priority }
 * @param {number} maxItems - 最大采集条目数
 * @returns {Promise<Array>} 新闻条目列表
 */
async function collectFromSource(source, maxItems = 10) {
  switch (source.type) {
    case 'rss':
      return rssCollector.collect(source, maxItems);
    case 'api':
      return apiCollector.collect(source, maxItems);
    case 'crawler':
      return crawlerCollector.collect(source, maxItems);
    default:
      console.warn(`⚠️ 未知采集类型: ${source.type} (${source.name})`);
      return [];
  }
}

/**
 * 批量采集所有数据源
 * @param {Array} sources - 数据源配置列表
 * @param {number} maxItemsPerSource - 每个源的最大采集条目数
 * @returns {Promise<Array>} 所有新闻条目列表
 */
async function collectAll(sources, maxItemsPerSource = 10) {
  console.log(`\n🚀 开始采集 ${sources.length} 个数据源...\n`);

  // 按优先级排序，高优先级先采集
  const sorted = [...sources].sort((a, b) => (a.priority || 99) - (b.priority || 99));

  // 并发采集所有源
  const results = await Promise.allSettled(
    sorted.map((source) => collectFromSource(source, maxItemsPerSource))
  );

  // 汇总结果
  const allItems = results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  );

  console.log(`\n📊 采集完成: 共 ${allItems.length} 条新闻\n`);
  return allItems;
}

module.exports = { collectFromSource, collectAll };
