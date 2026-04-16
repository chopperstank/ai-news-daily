module.exports = {
  apps: [{
    name: 'ai-news-daily',
    script: 'app.js',
    cwd: '/www/wwwroot/nodejs/github_news',
    instances: 1,
    autorestart: true,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production',
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: '/www/wwwroot/nodejs/github_news/logs/error.log',
    out_file: '/www/wwwroot/nodejs/github_news/logs/out.log',
    merge_logs: true,
  }],
};
