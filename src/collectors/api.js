/**
 * API 数据采集器
 * 支持 Hacker News、Product Hunt 等 API
 */

const axios = require('axios');

const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;
const TIMEOUT = 15000;

const axiosInstance = axios.create({
  timeout: TIMEOUT,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; AINewsDaily/1.0)',
    Accept: 'application/json',
  },
});

/**
 * 通用 HTTP 请求（带重试）
 */
async function fetchWithRetry(url, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      const response = await axiosInstance.get(url);
      return response.data;
    } catch (error) {
      if (i === retries) throw error;
      console.warn(`⚠️ [API] 请求失败，${RETRY_DELAY}ms 后重试 (${i + 1}/${retries}): ${url}`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY * (i + 1)));
    }
  }
}

/**
 * Hacker News 采集
 * 获取 Top 10 最新故事
 */
async function collectHackerNews(maxItems = 10) {
  try {
    console.log('📡 [API] 采集中: Hacker News');
    const topStoryIds = await fetchWithRetry(
      'https://hacker-news.firebaseio.com/v0/topstories.json'
    );
    const ids = topStoryIds.slice(0, maxItems);

    // 并发获取每条故事的详情
    const items = await Promise.allSettled(
      ids.map(async (id) => {
        const story = await fetchWithRetry(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`
        );
        return {
          title: story.title || '无标题',
          link: story.url || `https://news.ycombinator.com/item?id=${id}`,
          description: story.title || '', // HN 没有摘要，用标题
          pubDate: new Date(story.time * 1000).toISOString(),
          source: 'Hacker News',
          category: 'AI/ML',
          type: 'api',
          score: story.score || 0,
        };
      })
    );

    const successful = items
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);

    console.log(`✅ [API] Hacker News: 采集 ${successful.length} 条`);
    return successful;
  } catch (error) {
    console.error(`❌ [API] Hacker News 采集失败: ${error.message}`);
    return [];
  }
}

/**
 * Product Hunt 采集
 * 通过公开 API 获取今日热门产品
 */
async function collectProductHunt(maxItems = 10) {
  try {
    console.log('📡 [API] 采集中: Product Hunt');
    // Product Hunt GraphQL API 需要认证，这里用备用方案：
    // 通过 token 获取今日热门
    const response = await axiosInstance.get(
      'https://www.producthunt.com/frontend/graphql',
      {
        headers: {
          Accept: '*/*',
          'Content-Type': 'application/json',
        },
        data: JSON.stringify({
          query: `
            query { 
              posts(order: VOTES, first: ${maxItems}) {
                edges {
                  node {
                    name
                    tagline
                    url
                    votesCount
                    createdAt
                  }
                }
              }
            }
          `,
        }),
      }
    );

    if (response.data?.data?.posts?.edges) {
      const items = response.data.data.posts.edges.map((edge) => ({
        title: edge.node.name,
        link: `https://www.producthunt.com${edge.node.url || '/posts/' + edge.node.name}`,
        description: edge.node.tagline || '',
        pubDate: edge.node.createdAt || new Date().toISOString(),
        source: 'Product Hunt',
        category: 'DevTools',
        type: 'api',
        score: edge.node.votesCount || 0,
      }));
      console.log(`✅ [API] Product Hunt: 采集 ${items.length} 条`);
      return items;
    }
    console.log('⚠️ [API] Product Hunt: 返回数据为空，跳过');
    return [];
  } catch (error) {
    console.error(`❌ [API] Product Hunt 采集失败: ${error.message}`);
    return [];
  }
}

/**
 * 根据数据源名称路由到对应的采集函数
 * @param {Object} source - 数据源配置
 * @param {number} maxItems - 最大采集条目数
 * @returns {Array} 新闻条目列表
 */
async function collect(source, maxItems = 10) {
  switch (source.name) {
    case 'Hacker News':
      return collectHackerNews(maxItems);
    case 'Product Hunt':
      return collectProductHunt(maxItems);
    default:
      console.warn(`⚠️ [API] 未知 API 源: ${source.name}，跳过`);
      return [];
  }
}

module.exports = { collect, fetchWithRetry };
