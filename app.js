const express = require('express');
const config = require('./config');
const projectsRouter = require('./routes/projects');
const dataRouter = require('./routes/data');
const scheduler = require('./scheduler');
const { startEmailScheduler, isConfigured } = require('./services/email');

const app = express();

app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api/projects', projectsRouter);
app.use('/api/data', dataRouter);

app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'ok' });
});

// 模块一：向浏览器暴露安全的运行配置（不含任何密钥 / SMTP 口令）
app.get('/api/config', (req, res) => {
  res.json({
    code: 0,
    data: {
      ...config.publicConfig,
      deepseekApiBase: config.deepseekBaseURL,
      emailConfigured: isConfigured()
    }
  });
});

scheduler.start();
startEmailScheduler();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[App] DeepSeek Monitor 已启动: http://0.0.0.0:${config.port}`);
});

server.on('error', (err) => {
  console.error('[App] 启动失败:', err.message);
  process.exit(1);
});

// 优雅退出：停止余额轮询与邮件任务
function shutdown() {
  console.log('\n[App] 正在关闭...');
  scheduler.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
