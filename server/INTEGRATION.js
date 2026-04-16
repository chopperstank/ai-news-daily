/**
 * AI News Daily - 完整部署指南
 * ============================================================
 *
 * 服务器项目目录：/www/wwwroot/nodejs/github_news/
 * 数据库：ai_nav (MySQL)
 * 端口：3389
 *
 * ============================================================
 * 第一步：上传文件到服务器
 * ============================================================
 *
 * 将 server/ 目录下所有文件上传到服务器：
 *
 *   server/
 *   ├── app.js                  # 主入口
 *   ├── package.json            # 依赖声明
 *   ├── ecosystem.config.js     # PM2 配置
 *   ├── verify.js               # 验证脚本
 *   ├── .env                    # 环境变量（修改后上传）
 *   ├── routes/
 *   │   └── news.js             # API 路由
 *   └── database/
 *       └── init.sql            # 建表 SQL
 *
 * ============================================================
 * 第二步：初始化数据库
 * ============================================================
 *
 *   mysql -u root -p ai_nav < database/init.sql
 *
 * 此脚本支持幂等执行：
 *   - 表已存在 → 跳过创建
 *   - 字段已存在 → 跳过添加
 *   - 索引已存在 → 跳过创建
 *
 * ============================================================
 * 第三步：安装依赖
 * ============================================================
 *
 *   cd /www/wwwroot/nodejs/github_news
 *   npm install
 *
 * 只需 4 个包：express、mysql2、cors、helmet
 *
 * ============================================================
 * 第四步：生成 API Token
 * ============================================================
 *
 *   openssl rand -hex 32
 *
 * 将生成的字符串填入 .env 的 NEWS_API_TOKEN 字段
 * 例如：NEWS_API_TOKEN=a1b2c3d4e5f6...
 *
 * ============================================================
 * 第五步：验证环境
 * ============================================================
 *
 *   cd /www/wwwroot/nodejs/github_news
 *   node verify.js
 *
 * 预期输出（全部通过）：
 *   ✓ DB_HOST = localhost
 *   ✓ DB_USER = ai_nav
 *   ✓ DB_NAME = ai_nav
 *   ✓ NEWS_API_TOKEN = ***（长度 64 位）
 *   ✓ 数据库连接成功
 *   ✓ 数据库响应正常
 *   ✓ 字符集正常: utf8mb4
 *   ✓ news_buffer 表存在
 *   ✓ news_buffer 必要字段均存在
 *   ✓ news_buffer.source_url 唯一索引存在
 *   ✓ news_daily_log 表存在
 *   ✓ 测试数据写入成功
 *   ✓ 测试数据已清理
 *   ✓ NEWS_API_TOKEN 已配置（长度 64 位）
 *   ✅ 验证通过！14 项全部正常
 *
 * ============================================================
 * 第六步：启动服务
 * ============================================================
 *
 *   pm2 start ecosystem.config.js
 *
 * 常用 PM2 命令：
 *   pm2 list                  # 查看所有服务
 *   pm2 logs ai-news-daily    # 查看日志
 *   pm2 restart ai-news-daily # 重启
 *   pm2 stop ai-news-daily    # 停止
 *   pm2 delete ai-news-daily  # 删除
 *
 * ============================================================
 * 第七步：配置 Nginx 反向代理（可选）
 * ============================================================
 *
 * 在你的 Nginx 配置中添加：
 *
 *   server {
 *       listen 443 ssl;
 *       server_name news-api.yourdomain.com;
 *
 *       ssl_certificate     /path/to/cert.pem;
 *       ssl_certificate_key /path/to/key.pem;
 *
 *       location / {
 *           proxy_pass http://127.0.0.1:3389;
 *           proxy_set_header Host $host;
 *           proxy_set_header X-Real-IP $remote_addr;
 *           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 *           proxy_set_header X-Forwarded-Proto $scheme;
 *       }
 *   }
 *
 * 如果已有域名可以直接加 location：
 *
 *   location /api/news/ {
 *       proxy_pass http://127.0.0.1:3389;
 *       ...
 *   }
 *
 * ============================================================
 * 第八步：配置 GitHub Secrets
 * ============================================================
 *
 * GitHub 仓库 → Settings → Secrets and variables → Actions：
 *
 *   DASHSCOPE_API_KEY = sk-xxx（阿里百炼 API Key）
 *   NEWS_API_URL      = https://yourdomain.com/api/news/batch
 *   NEWS_API_TOKEN    = 第四步生成的 Token（与 .env 一致）
 *
 * ============================================================
 * API 接口文档
 * ============================================================
 *
 * 所有接口基础路径：http://localhost:3389/api/news
 *
 * 1. 健康检查（无需鉴权）
 *    GET  /api/news/health
 *    返回：{ success, api, db, token_configured, timestamp }
 *
 * 2. 批量写入新闻（需 Bearer Token）
 *    POST /api/news/batch
 *    Header: Authorization: Bearer <token>
 *    Body: {
 *      "date": "2026-04-16",
 *      "highlights": "今日要点文本...",
 *      "items": [{ title, category, summary, content, source, source_url, tags, is_featured }]
 *    }
 *
 * 3. 查询新闻列表（无需鉴权）
 *    GET /api/news?page=1&page_size=20&category=大模型&keyword=GPT&is_featured=1
 *    返回：{ success, data, pagination }
 *
 * 4. 查询某日新闻（无需鉴权）
 *    GET /api/news/daily/2026-04-16
 *    返回：{ success, data: { date, highlights, categories, total } }
 *
 * 5. 获取分类列表（无需鉴权）
 *    GET /api/news/categories
 *    返回：{ success, data: [{ name, emoji, sort, count }] }
 *
 * 6. 获取采集日志（无需鉴权）
 *    GET /api/news/logs?page=1&page_size=20
 *    返回：{ success, data, pagination }
 *
 * ============================================================
 * 安全说明
 * ============================================================
 *
 * - 只有 POST /api/news/batch 需要 Token 鉴权
 * - 查询接口（GET）无需 Token，可按需在 routes/news.js 中加 authMiddleware
 * - NEWS_API_TOKEN 同时配置在服务器 .env 和 GitHub Secrets
 * - 数据库用户 ai_nav 建议限制为 INSERT + SELECT 权限
 * - HTTPS 由 Nginx 终止，内网通信无需额外加密
 *
 * ============================================================
 * 目录结构
 * ============================================================
 *
 * /www/wwwroot/nodejs/github_news/
 * ├── app.js                  # 主入口（Express 服务）
 * ├── package.json            # 依赖声明
 * ├── package-lock.json       # 锁文件（npm install 后生成）
 * ├── ecosystem.config.js     # PM2 配置
 * ├── verify.js               # 环境验证脚本
 * ├── .env                    # 环境变量（不提交 Git）
 * ├── logs/                   # PM2 日志目录（自动创建）
 * │   ├── error.log
 * │   └── out.log
 * ├── routes/
 * │   └── news.js             # API 路由
 * └── database/
 *     └── init.sql            # 建表 SQL
 */
