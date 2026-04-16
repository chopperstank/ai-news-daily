/**
 * AI 处理模块
 * 使用阿里百炼 API（OpenAI 兼容接口）+ qwen3.5-flash 模型
 * 功能：新闻智能摘要、中英双语标题、今日要点
 */

const OpenAI = require('openai');

class AIProcessor {
  constructor(apiKey, model = 'qwen3.5-flash') {
    this.client = new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
    this.model = model;
    this.tokenUsage = { prompt: 0, completion: 0, total: 0 };
  }

  /**
   * 调用 AI 模型（带重试）
   */
  async chat(messages, options = {}) {
    const maxRetries = options.maxRetries || 2;
    const temperature = options.temperature || 0.3;

    for (let i = 0; i <= maxRetries; i++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages,
          temperature,
          max_tokens: options.maxTokens || 2000,
        });

        const usage = response.usage;
        if (usage) {
          this.tokenUsage.prompt += usage.prompt_tokens || 0;
          this.tokenUsage.completion += usage.completion_tokens || 0;
          this.tokenUsage.total += usage.total_tokens || 0;
        }

        return response.choices[0].message.content;
      } catch (error) {
        const isRetryable =
          error.status === 429 || error.status === 500 || error.status === 503;
        if (i === maxRetries || !isRetryable) {
          console.error(`❌ [AI] 调用失败: ${error.message}`);
          throw error;
        }
        const delay = 1000 * (i + 1);
        console.warn(`⚠️ [AI] 限流/错误，${delay}ms 后重试 (${i + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  /**
   * 可用分类枚举
   */
  static CATEGORIES = [
    '热门推荐', '大模型', 'AI写作', 'AI绘画', 'AI视频', 'AI聊天',
    'AI编程', 'AI音频', 'AI办公', 'AI产品', 'AI学习资料',
    'AI/ML', '开发工具', 'IDE', '开源', '云计算',
  ];

  /**
   * 生成单条新闻的中文摘要
   * @param {Object} item - 新闻条目 { title, link, description }
   * @returns {Promise<Object>} { summary, category, tags, is_featured }
   */
  async summarizeItem(item) {
    try {
      const systemPrompt = `你是一个专业的科技新闻编辑。请根据以下新闻标题和简介完成以下任务：

1. 生成一段简洁的中文摘要（1-2句话，50-100字）
2. 从可用的分类中选择最匹配的一个
3. 生成 2-5 个相关标签（逗号分隔）
4. 判断是否为精选内容（重要性高、影响力大的新闻标记为精选）

可用的分类（只能选一个）：
热门推荐、大模型、AI写作、AI绘画、AI视频、AI聊天、AI编程、AI音频、AI办公、AI产品、AI学习资料、AI/ML、开发工具、IDE、开源、云计算

请严格按照以下 JSON 格式返回，不要包含其他内容：
{"summary": "中文摘要内容", "category": "分类名称", "tags": "标签1,标签2,标签3", "is_featured": 0}

注意：is_featured 只能是 0 或 1，1 表示精选。大部分新闻设为 0，只有真正重要的设为 1。`;

      const userPrompt = `标题：${item.title}\n简介：${item.description || '无'}\n链接：${item.link}`;

      const result = await this.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.3, maxTokens: 300 }
      );

      // 解析 JSON 响应
      const cleanResult = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleanResult);

      // 校正分类到合法枚举
      let category = parsed.category || 'AI/ML';
      if (!AIProcessor.CATEGORIES.includes(category)) {
        category = 'AI/ML';
      }

      return {
        summary: parsed.summary || item.description || item.title,
        category,
        tags: parsed.tags || '',
        is_featured: parsed.is_featured === 1 ? 1 : 0,
      };
    } catch (error) {
      // 降级处理：AI 失败时使用原始描述
      return {
        summary: item.description || item.title,
        category: 'AI/ML',
        tags: '',
        is_featured: 0,
      };
    }
  }

  /**
   * 批量生成新闻摘要
   * @param {Array} items - 新闻条目列表
   * @returns {Promise<Array>} 带摘要的新闻条目
   */
  async summarizeBatch(items, concurrency = 3) {
    const total = items.length;
    const totalBatches = Math.ceil(total / concurrency);
    console.log(`🤖 [AI] 开始批量摘要 ${total} 条新闻（并发数: ${concurrency}，共 ${totalBatches} 批）`);
    console.log(`   ⏳ 预计耗时约 ${Math.ceil(totalBatches * 3)} ~ ${Math.ceil(totalBatches * 6)} 秒，请耐心等待...`);

    const results = [];
    const batches = [];

    // 分批处理
    for (let i = 0; i < items.length; i += concurrency) {
      batches.push(items.slice(i, i + concurrency));
    }

    let completed = 0;
    const startTime = Date.now();

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          const enriched = await this.summarizeItem(item);
          completed++;
          return { ...item, ...enriched };
        })
      );
      results.push(...batchResults);

      // 每批完成后都打印进度
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const percent = Math.round((completed / total) * 100);
      const eta = completed < total
        ? `，预计剩余 ${Math.ceil(((Date.now() - startTime) / completed) * (total - completed) / 1000)}s`
        : '';
      console.log(`   ✦ 批次 ${batchIdx + 1}/${totalBatches} 完成 → ${completed}/${total} 条 (${percent}%) | 已耗时 ${elapsed}s${eta}`);
    }

    console.log(`✅ [AI] 批量摘要完成，共处理 ${total} 条`);
    return results;
  }

  /**
   * 生成今日要点总结
   * @param {Array} items - 带摘要的新闻条目列表
   * @returns {Promise<string>} 今日要点 Markdown 文本
   */
  async generateDailyHighlights(items) {
    try {
      console.log('🤖 [AI] 生成今日要点...');

      // 按分类聚合，每个分类取前3条标题
      const categoryMap = {};
      items.forEach((item) => {
        const cat = item.category || '其他';
        if (!categoryMap[cat]) categoryMap[cat] = [];
        if (categoryMap[cat].length < 3) {
          categoryMap[cat].push(`- ${item.title}`);
        }
      });

      const newsOverview = Object.entries(categoryMap)
        .map(([cat, headlines]) => `【${cat}】\n${headlines.join('\n')}`)
        .join('\n\n');

      const systemPrompt = `你是一个专业的科技新闻编辑。请根据以下今日科技新闻概览，生成一份简洁的"今日要点"总结。

要求：
1. 总结 3-5 条最重要的科技动态
2. 每条用一句话概括核心内容
3. 语言简洁有力，适合快速浏览
4. 使用中文
5. 严格按以下格式输出：

- 📌 要点1
- 📌 要点2
- 📌 要点3`;

      const userPrompt = `以下是今日 ${new Date().toLocaleDateString('zh-CN')} 的科技新闻概览：\n\n${newsOverview}`;

      const result = await this.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.5, maxTokens: 500 }
      );

      console.log('✅ [AI] 今日要点生成完成');
      return result.trim();
    } catch (error) {
      console.error(`❌ [AI] 今日要点生成失败: ${error.message}`);
      return '今日要点生成失败，请查看下方新闻列表。';
    }
  }

  /**
   * 获取 Token 使用统计
   */
  getTokenUsage() {
    return this.tokenUsage;
  }

  /**
   * 打印 Token 使用统计
   */
  printTokenUsage() {
    console.log(
      `\n💰 Token 使用统计: ` +
        `输入=${this.tokenUsage.prompt}, ` +
        `输出=${this.tokenUsage.completion}, ` +
        `总计=${this.tokenUsage.total}`
    );
  }
}

module.exports = AIProcessor;
