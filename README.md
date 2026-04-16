# AI News Daily 🤖

每日自动采集科技新闻，AI 生成中文摘要，输出 JSON 数据并同步到 MySQL 数据库。

## 架构流程

```
GitHub Actions（每日定时）
    │
    ├── 📡 采集 12 个科技信息源（RSS / API / 爬虫）
    ├── 🔄 URL 去重
    ├── 🤖 AI 智能摘要（阿里百炼 qwen3.5-flash）
    ├── 📝 生成 JSON + Markdown 日报
    ├── 📡 同步到 MySQL 数据库（通过 API）
    └── 📤 Git 提交 & 推送
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填写 DASHSCOPE_API_KEY
```

### 3. 运行

```bash
npm start              # 完整流程（采集 + AI + 生成 + 同步）
npm run collect        # 仅采集（调试用）
npm run list           # 查看日报列表
npm run preview        # 本地预览网站
```

## 数据库部署

### 第一步：执行建表 SQL

```bash
mysql -u root -p plugintab < database/init.sql
```

### 第二步：部署 API 到服务器

1. 将 `server/routes/news.js` 复制到服务器 Node.js 项目的 `routes/` 目录
2. 在 `app.js` 中挂载路由：

```js
const newsRoutes = require('./routes/news');
app.use('/api/news', newsRoutes);
```

3. 服务器 `.env` 中添加 API Token：

```bash
# 生成随机 Token
openssl rand -hex 32
# 将结果填入
NEWS_API_TOKEN=你生成的随机字符串
```

4. 重启服务：`pm2 restart your-app`

### 第三步：验证 API

```bash
# 健康检查
curl https://plugin.stank.top:9966/api/news/health

# 测试写入（替换 TOKEN）
curl -X POST https://plugin.stank.top:9966/api/news/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的TOKEN" \
  -d '{
    "date": "2026-04-16",
    "highlights": "测试要点",
    "items": [{
      "title": "测试新闻",
      "category": "AI/ML",
      "summary": "测试摘要",
      "source": "Test",
      "source_url": "https://example.com/test-unique-url",
      "tags": "test",
      "is_featured": 0
    }]
  }'
```

### 第四步：配置 GitHub Secrets

在 GitHub 仓库 → Settings → Secrets and variables → Actions 中添加：

| Secret 名称 | 值 | 说明 |
|---|---|---|
| `DASHSCOPE_API_KEY` | `sk-xxx` | 阿里百炼 API Key |
| `NEWS_API_URL` | `https://plugin.stank.top:9966/api/news/batch` | 同步 API 地址 |
| `NEWS_API_TOKEN` | `你生成的随机Token` | API 鉴权 Token |

## 安全设计

| 层级 | 措施 | 说明 |
|---|---|---|
| **传输安全** | HTTPS | 数据加密传输 |
| **接口鉴权** | Bearer Token | 只有持有 Token 才能调用 |
| **密钥管理** | GitHub Secrets | 加密存储，日志自动打码 |
| **数据校验** | 逐条字段校验 | 防注入、防超长、枚举校验 |
| **防重复** | source_url 唯一索引 | 重复数据自动覆盖 |
| **最小权限** | INSERT + SELECT | 数据库用户只有写入权限 |
| **事务保证** | MySQL Transaction | 全部成功或全部回滚 |
| **错误处理** | 3 次重试 + 递增延迟 | 网络波动自动恢复 |

## 数据源配置

编辑 `sources.json` 增删数据源，支持三种类型：

| 类型 | 说明 | 新增难度 |
|---|---|---|
| `rss` | 解析 RSS/Atom 订阅 | ⭐ 简单 |
| `api` | 调用公开 API | ⭐ 简单 |
| `crawler` | HTML 页面爬虫 | ⭐⭐ 中等 |

## 输出格式

### JSON（主要输出）

```json
{
  "title": "新闻标题",
  "category": "大模型",
  "summary": "AI生成摘要",
  "content": "正文内容",
  "source": "TechCrunch",
  "source_url": "https://...",
  "tags": "GPT-5,OpenAI",
  "is_featured": 1,
  "status": 1,
  "synced": 0
}
```

### 数据库表结构

- `news` - 新闻表（含唯一索引防重复）
- `news_daily_log` - 每日采集日志
- `v_news_categories` - 分类枚举视图

16 个分类：热门推荐、大模型、AI写作、AI绘画、AI视频、AI聊天、AI编程、AI音频、AI办公、AI产品、AI学习资料、AI/ML、开发工具、IDE、开源、云计算
