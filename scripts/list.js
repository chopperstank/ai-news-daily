/**
 * 查看已生成的日报列表
 * 运行: node scripts/list.js
 */
const fs = require('fs');
const path = require('path');

const indexPath = path.resolve(__dirname, '../site/daily/index.json');
const dailyDir = path.resolve(__dirname, '../site/daily');

if (!fs.existsSync(indexPath)) {
  console.log('\n📭 暂无日报记录，请先运行: npm start\n');
  process.exit(0);
}

const list = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

console.log('\n╔═══════════════════════════════════════════════════╗');
console.log('║         📰 AI News Daily - 日报列表               ║');
console.log('╚═══════════════════════════════════════════════════╝\n');

if (list.length === 0) {
  console.log('  暂无日报，请先运行: npm start\n');
  process.exit(0);
}

list.forEach((f, i) => {
  const mdFile = path.join(dailyDir, `${f.date}.md`);
  const exists = fs.existsSync(mdFile);
  console.log(`  ${i + 1}. 📅 ${f.date}   📄 ${f.count} 条新闻   ${exists ? '✅' : '❌'}`);
});

// 显示最新日报的前 50 行
const latest = list[0];
if (latest) {
  const mdPath = path.join(dailyDir, `${latest.date}.md`);
  if (fs.existsSync(mdPath)) {
    const content = fs.readFileSync(mdPath, 'utf-8');
    const lines = content.split('\n').slice(0, 60);
    console.log(`\n${'─'.repeat(52)}`);
    console.log(`  📖 最新日报预览：${latest.date}`);
    console.log(`${'─'.repeat(52)}\n`);
    console.log(lines.join('\n'));
    if (content.split('\n').length > 60) {
      console.log('\n  ... (更多内容请运行 npm run preview 在浏览器查看)\n');
    }
  }
}

console.log('\n💡 提示:');
console.log('  npm run preview    → 启动本地网站（http://localhost:4000）');
console.log('  npm start          → 重新采集今日新闻\n');
