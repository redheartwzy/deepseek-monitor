const express = require('express');
const config = require('./config');
const projectsRouter = require('./routes/projects');
const dataRouter = require('./routes/data');
const scheduler = require('./scheduler');

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

scheduler.start();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[App] DeepSeek Monitor 已启动: http://0.0.0.0:${config.port}`);
});

server.on('error', (err) => {
  console.error('[App] 启动失败:', err.message);
  process.exit(1);
});
