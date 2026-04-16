/**
 * 日报生成器
 * 支持 Markdown 和 JSON 两种输出格式
 */

const dayjs = require('dayjs');
require('dayjs/locale/zh-cn');
dayjs.locale('zh-cn');

/**
 * 生成每日新闻 JSON 数据
 * @param {Object} options
 * @param {Array} options.items - 新闻条目列表
 * @param {string} options.highlights - AI 生成的今日要点
 * @param {string} options.date - 日期字符串 (YYYY-MM-DD)
 * @returns {Array} JSON 数组，每条新闻包含 title/category/summary/content/source/source_url/tags/is_featured/status/synced
 */
function generateDailyJson({ items, highlights, date }) {
  return items.map((item) => ({
    title: item.title || '',
    category: normalizeCategory(item.category),
    summary: item.summary || item.description || item.title || '',
    content: item.content || item.description || '',
    source: item.source || '',
    source_url: item.link || item.url || '',
    tags: item.tags || '',
    is_featured: item.is_featured || 0,
    status: 1,
    synced: 0,
  }));
}

/**
 * 生成每日新闻 Markdown（保留兼容）
 * @param {Object} options
 * @param {Array} options.items - 新闻条目列表
 * @param {string} options.highlights - AI 生成的今日要点
 * @param {string} options.date - 日期字符串 (YYYY-MM-DD)
 * @returns {string} 完整的 Markdown 内容
 */
function generateDailyMarkdown({ items, highlights, date }) {
  const today = dayjs(date);
  const dateStr = today.format('YYYY年MM月DD日');
  const weekDay = today.format('dddd');
  const slug = today.format('YYYY-MM-DD');
  const itemCount = items.length;

  // 按分类分组
  const grouped = groupByCategory(items);

  let md = '';
  md += `---\n`;
  md += `title: "AI 日报 - ${dateStr}"\n`;
  md += `date: ${slug}\n`;
  md += `weekday: ${weekDay}\n`;
  md += `count: ${itemCount}\n`;
  md += `---\n\n`;
  md += `# 🤖 AI 日报 | ${dateStr} ${weekDay}\n\n`;
  md += `> 每日自动采集科技新闻，AI 智能生成中文摘要。共 ${itemCount} 条新闻。\n\n`;

  // 今日要点
  if (highlights) {
    md += `## 📌 今日要点\n\n`;
    md += `${highlights}\n\n`;
    md += `---\n\n`;
  }

  // 分类新闻
  const categoryEmojis = {
    '热门推荐': '🔥', '大模型': '🧠', 'AI写作': '✍️', 'AI绘画': '🎨', 'AI视频': '🎬',
    'AI聊天': '💬', 'AI编程': '👨‍💻', 'AI音频': '🎧', 'AI办公': '📊', 'AI产品': '📦',
    'AI学习资料': '📚', 'AI/ML': '🤖', '开发工具': '🛠️', 'IDE': '💻', '开源': '📬', '云计算': '☁️',
    '人工智能': '🧠', '科技': '🌐', '其他': '📰',
  };

  for (const [category, categoryItems] of Object.entries(grouped)) {
    const emoji = categoryEmojis[category] || '📰';
    md += `## ${emoji} ${category}\n\n`;

    categoryItems.forEach((item, index) => {
      md += `### ${index + 1}. ${item.title}\n\n`;
      if (item.summary) {
        md += `${item.summary}\n\n`;
      }
      md += `🔗 [查看原文](${item.link})`;
      if (item.source) {
        md += ` | 来源: ${item.source}`;
      }
      md += '\n\n';
    });

    md += `---\n\n`;
  }

  // 页脚
  md += `---\n\n`;
  md += `> 📅 本期日报由 AI 自动生成于 ${dayjs().format('YYYY-MM-DD HH:mm')}\n`;
  md += `> 🔄 数据来源：Hacker News、GitHub Trending、TechCrunch、The Verge 等\n`;
  md += `> 🤖 摘要由 ${process.env.AI_MODEL || 'qwen3.5-flash'} 生成\n`;

  return md;
}

/**
 * 合法分类枚举
 */
const VALID_CATEGORIES = [
  '热门推荐', '大模型', 'AI写作', 'AI绘画', 'AI视频', 'AI聊天',
  'AI编程', 'AI音频', 'AI办公', 'AI产品', 'AI学习资料',
  'AI/ML', '开发工具', 'IDE', '开源', '云计算',
];

/**
 * 分类关键词映射（AI 未返回时用于回退匹配）
 */
const CATEGORY_KEYWORDS = {
  '热门推荐': ['breaking', '重磅', '突发', '重大', 'major'],
  '大模型': ['gpt', 'llm', '大模型', 'claude', 'gemini', 'qwen', 'lama', 'mistral', 'model', 'language model'],
  'AI写作': ['writing', '写作', '文案', 'copywriting', 'jasper'],
  'AI绘画': ['image', 'painting', 'dall-e', 'midjourney', 'stable diffusion', '绘画', '绘图', 'sd', 'flux'],
  'AI视频': ['video', 'sora', 'runway', 'pika', 'kling', '视频', '视频生成'],
  'AI聊天': ['chatbot', 'chat', '对话', 'assistant', 'copilot'],
  'AI编程': ['coding', 'programming', 'github', 'coder', 'devin', 'cursor', '编程', '代码', 'windsurf'],
  'AI音频': ['audio', 'music', 'speech', 'tts', 'voice', '音频', '音乐', '语音'],
  'AI办公': ['office', 'productivity', 'workspace', '办公', '效率', '自动化'],
  'AI产品': ['product', 'release', 'launch', '发布', '上线', 'update', 'version'],
  'AI学习资料': ['tutorial', 'course', 'learn', 'guide', '教程', '学习', '入门'],
  'AI/ML': ['ai', 'ml', 'deep learning', 'machine learning', 'neural', '人工智能', '机器学习', '深度学习'],
  '开发工具': ['dev', 'tool', 'developer', 'sdk', 'api', '开发', '工具', 'framework'],
  'IDE': ['ide', 'editor', 'vscode', 'jetbrains', 'intellij', '编辑器'],
  '开源': ['open source', 'github', '开源', 'repository', 'repo'],
  '云计算': ['cloud', 'aws', 'azure', 'gcp', 'cloudflare', 'serverless', '云'],
};

/**
 * 将分类名称规范化到合法枚举值
 */
function normalizeCategory(category) {
  if (!category) return 'AI/ML';
  if (VALID_CATEGORIES.includes(category)) return category;

  // 关键词匹配回退
  const lower = category.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return cat;
    }
  }

  // 默认归类
  if (/人工智能|科技|商业|硬件|安全|移动/.test(category)) return 'AI/ML';
  return 'AI/ML';
}

/**
 * 按分类分组
 */
function groupByCategory(items) {
  const groups = {};
  for (const item of items) {
    const cat = normalizeCategory(item.category);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }
  // 按条目数降序排列
  return Object.fromEntries(
    Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  );
}

/**
 * 生成索引页（首页列表）
 * @param {Array} dailyFiles - 已有的日报文件列表 [{ date, title, count }]
 * @returns {string} 索引页 Markdown
 */
function generateIndexMarkdown(dailyFiles) {
  let md = '';
  md += `# 🤖 AI News Daily\n\n`;
  md += `> 每日自动采集科技新闻，AI 智能生成中文摘要\n\n`;
  md += `---\n\n`;
  md += `## 📰 历史日报\n\n`;

  if (dailyFiles.length === 0) {
    md += `_暂无日报_`;
  } else {
    dailyFiles.forEach((file) => {
      md += `- [${file.title}](${file.path}) - ${file.count} 条新闻\n`;
    });
  }

  md += `\n---\n\n`;
  md += `> ⚡ 由 [AI News Daily](https://github.com) 自动生成\n`;

  return md;
}

module.exports = {
  generateDailyJson,
  generateDailyMarkdown,
  generateIndexMarkdown,
  normalizeCategory,
};
