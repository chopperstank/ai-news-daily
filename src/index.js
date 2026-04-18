/**
 * AI News Daily - 主入口
 * 每日自动采集科技新闻 → AI 生成摘要 → 发布网站
 *
 * 运行方式：
 *   node src/index.js              # 完整流程（采集 + AI + 生成）
 *   node src/index.js --collect-only  # 仅采集（不调用 AI）
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
require('dayjs/locale/zh-cn');
dayjs.locale('zh-cn');

const { collectAll } = require('./collectors');
const { dedupByUrl } = require('./processors/dedup');
const AIProcessor = require('./processors/ai');
const { generateDailyMarkdown, generateIndexMarkdown, generateDailyJson, generateBasicItems, generateBasicItemsRaw } = require('./processors/generator');
const { syncToDatabase } = require('./processors/sync');

// ==================== 配置 ====================
const CONFIG = {
  apiKey: process.env.DASHSCOPE_API_KEY,
  model: process.env.AI_MODEL || 'qwen3.5-flash',
  maxItemsPerSource: parseInt(process.env.MAX_ITEMS_PER_SOURCE) || 10,
  maxItemsForSummary: parseInt(process.env.MAX_ITEMS_FOR_SUMMARY) || 30,
  outputDir: path.resolve(__dirname, '../site/daily'),
  sourcesFile: path.resolve(__dirname, '../sources.json'),
};

// ==================== 加载数据源配置 ====================
function loadSources(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);
  return (data.sources || []).filter((s) => s.enabled !== false && s.type);
}

// ==================== 生成日报 HTML ====================
function generateDailyHtml(markdownContent, dateStr) {
  // 读取主站 HTML 模板
  const templatePath = path.resolve(__dirname, '../site/index.html');
  const template = fs.readFileSync(templatePath, 'utf-8');
  // 日报页面和首页使用相同模板，通过路由区分
  return template;
}

// ==================== 更新索引 JSON ====================
function updateIndexJson(dateStr, title, count) {
  const indexPath = path.join(CONFIG.outputDir, 'index.json');
  let files = [];

  if (fs.existsSync(indexPath)) {
    try {
      files = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch {
      files = [];
    }
  }

  // 避免重复
  const exists = files.find((f) => f.date === dateStr);
  if (!exists) {
    files.push({ date: dateStr, title, count, path: `daily/${dateStr}.html` });
  }

  // 按日期降序
  files.sort((a, b) => b.date.localeCompare(a.date));

  fs.writeFileSync(indexPath, JSON.stringify(files, null, 2), 'utf-8');
  console.log(`📝 [索引] 更新索引，共 ${files.length} 期日报`);
}

// ==================== 主流程 ====================
async function main() {
  const startTime = Date.now();
  const collectOnly = process.argv.includes('--collect-only');
  const today = dayjs().format('YYYY-MM-DD');

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  🤖 AI News Daily`);
  console.log(`  📅 ${dayjs().format('YYYY年MM月DD日 dddd')}`);
  console.log(`  📝 模式: ${collectOnly ? '仅采集' : '完整流程'}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // 1. 加载数据源配置
  console.log('📋 加载数据源配置...');
  const sources = loadSources(CONFIG.sourcesFile);
  console.log(`   已加载 ${sources.length} 个数据源\n`);

  // 2. 数据采集
  const rawItems = await collectAll(sources, CONFIG.maxItemsPerSource);
  if (rawItems.length === 0) {
    console.error('❌ 未采集到任何新闻，流程终止');
    process.exit(1);
  }

  // 3. 去重
  const dedupedItems = dedupByUrl(rawItems);
  console.log(`\n📊 采集统计: 原始 ${rawItems.length} 条 → 去重后 ${dedupedItems.length} 条`);

  if (collectOnly) {
    // 仅采集模式：输出 JSON
    const outputPath = path.join(CONFIG.outputDir, `${today}-raw.json`);
    fs.writeFileSync(outputPath, JSON.stringify(dedupedItems, null, 2), 'utf-8');
    console.log(`\n💾 原始数据已保存: ${outputPath}`);
    return;
  }

  // 4. AI 处理（仅处理前 N 条，控制成本）
  if (!CONFIG.apiKey) {
    console.error('❌ 未配置 DASHSCOPE_API_KEY，无法调用 AI');
    process.exit(1);
  }

  const ai = new AIProcessor(CONFIG.apiKey, CONFIG.model);

  // 限制 AI 处理的新闻数量（控制成本），但保留所有新闻用于数据库同步
  const itemsForAI = dedupedItems.slice(0, CONFIG.maxItemsForSummary);
  const itemsWithoutAI = dedupedItems.slice(CONFIG.maxItemsForSummary);

  if (itemsWithoutAI.length > 0) {
    console.log(`📌 AI 将处理前 ${itemsForAI.length} 条（生成摘要），剩余 ${itemsWithoutAI.length} 条将以基础信息入库`);
  }

  // 4a. 批量生成摘要
  const enrichedItems = await ai.summarizeBatch(itemsForAI, 3);

  // 4b. 生成今日要点
  const highlights = await ai.generateDailyHighlights(enrichedItems);

  // 打印 Token 使用
  ai.printTokenUsage();

  // 5. 生成 JSON 数据（仅包含 AI 处理的精选条目，用于日报展示）
  console.log('\n📝 生成 JSON 数据...');
  const jsonData = generateDailyJson({
    items: enrichedItems,
    highlights,
    date: today,
  });

  // 为未经 AI 处理的新闻生成基础 JSON
  const basicItems = generateBasicItems(itemsWithoutAI, today);

  // 合并：AI 处理的 + 基础信息的 = 全部新闻
  const allItemsJson = [...jsonData, ...basicItems];

  // 确保输出目录存在
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const jsonPath = path.join(CONFIG.outputDir, `${today}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(allItemsJson, null, 2), 'utf-8');
  console.log(`💾 JSON 数据已保存: ${jsonPath}（AI摘要 ${enrichedItems.length} + 基础信息 ${itemsWithoutAI.length} = ${allItemsJson.length} 条）`);

  // 6. 生成 Markdown 日报（仅包含 AI 处理的精选条目，用于网站展示）
  console.log('📝 生成 Markdown 日报...');
  const markdown = generateDailyMarkdown({
    items: enrichedItems,
    highlights,
    date: today,
  });

  const mdPath = path.join(CONFIG.outputDir, `${today}.md`);
  fs.writeFileSync(mdPath, markdown, 'utf-8');
  console.log(`💾 日报已保存: ${mdPath}`);

  // 7. 更新索引
  updateIndexJson(today, `AI 日报 - ${dayjs().format('YYYY年MM月DD日')}`, allItemsJson.length);

  // 8. 同步到数据库（同步全部新闻，包括未经 AI 处理的）
  console.log('\n📡 同步数据到数据库...');
  // 合并 AI 处理的条目和基础条目用于同步
  const allItemsForSync = [
    ...enrichedItems,
    ...generateBasicItemsRaw(itemsWithoutAI),
  ];
  const syncResult = await syncToDatabase({
    items: allItemsForSync,
    highlights,
    date: today,
  });

  // 9. 完成
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  ✅ 日报生成完成！`);
  console.log(`  📄 ${allItemsJson.length} 条新闻（AI摘要 ${enrichedItems.length} + 基础信息 ${itemsWithoutAI.length}）`);
  if (syncResult.success) {
    console.log(`  📡 数据库: 新增${syncResult.inserted} 更新${syncResult.updated} 跳过${syncResult.skipped}`);
  } else if (!syncResult.skipped) {
    console.log(`  ⚠️  数据库同步失败: ${syncResult.error}`);
  }
  console.log(`  ⏱️  耗时 ${elapsed}s`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
}

// 运行
main().catch((error) => {
  console.error('❌ 运行出错:', error);
  process.exit(1);
});
