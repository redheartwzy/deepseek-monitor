const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let tray = null;
let serverProc = null;
let isQuitting = false;

// ===== 内联加载页面 =====
function loadingHTML(msg, isError = false) {
  const color = isError ? '#dc2626' : '#64748b';
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#1e293b;padding:20px}
.spinner{width:36px;height:36px;border:3px solid #e2e8f0;border-top-color:#3b82f6;border-radius:50%;animation:s .7s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}p{margin-top:16px;font-size:14px;color:${color};text-align:center}
${isError ? 'button{margin-top:20px;padding:10px 28px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}' : ''}
</style></head><body>
${isError ? '' : '<div class="spinner"></div>'}
<p>${msg}</p>
${isError ? '<button onclick="location.reload()">重试</button>' : ''}
</body></html>`)}`;
}

// ===== 后端进程管理 =====
function startServer() {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'app.js');
    serverProc = spawn(process.execPath, [script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProc.stdout.on('data', d => process.stdout.write(`[Server] ${d}`));
    serverProc.stderr.on('data', d => process.stderr.write(`[Server] ${d}`));
    serverProc.on('error', err => reject(err));
    serverProc.on('exit', code => {
      if (!isQuitting) console.log(`[Server] 进程退出 code=${code}`);
    });

    // 轮询健康检查，等待服务就绪
    const TIMEOUT = 25000;
    const startTime = Date.now();

    function poll() {
      if (isQuitting) return reject(new Error('app quitting'));
      const req = http.get('http://127.0.0.1:3000/api/health', res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j.code === 0) return resolve();
          } catch (e) { /* retry */ }
          retry();
        });
      });
      req.on('error', () => retry());
      req.setTimeout(2000, () => { req.destroy(); retry(); });
    }

    function retry() {
      if (Date.now() - startTime > TIMEOUT) return reject(new Error('服务启动超时'));
      setTimeout(poll, 600);
    }

    poll();
  });
}

function stopServer() {
  if (!serverProc) return;
  try {
    serverProc.kill('SIGTERM');
    // Windows 上 force kill
    setTimeout(() => {
      try { serverProc.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }, 2000);
  } catch (e) { /* ignore */ }
  serverProc = null;
}

// ===== 窗口 =====
function createWindow() {
  const iconPath = path.join(__dirname, 'icon.png');
  const winIcon = nativeImage.createFromPath(iconPath);

  mainWindow = new BrowserWindow({
    width: 1250,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    icon: winIcon.isEmpty() ? undefined : winIcon,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });

  mainWindow.loadURL(loadingHTML('正在启动后端服务...'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 关闭窗口 → 隐藏到托盘（方案A）
  mainWindow.on('close', e => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ===== 系统托盘 =====
function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  let trayIcon = nativeImage.createFromPath(iconPath);
  if (trayIcon.isEmpty()) {
    // 兜底：生成一个纯色小图标
    const buf = Buffer.alloc(16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i++) {
      buf[i * 4] = 59; buf[i * 4 + 1] = 130;
      buf[i * 4 + 2] = 246; buf[i * 4 + 3] = 255;
    }
    trayIcon = nativeImage.createFromBuffer(buf, { width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('DeepSeek Monitor - 运行中');

  const ctxMenu = Menu.buildFromTemplate([
    {
      label: '打开监控面板',
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } }
    },
    { type: 'separator' },
    {
      label: '退出程序（同时停止后端服务）',
      click: () => {
        isQuitting = true;
        stopServer();
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(ctxMenu);
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ===== App 生命周期 =====
app.whenReady().then(async () => {
  createWindow();
  createTray();

  try {
    await startServer();
    console.log('[App] 后端服务就绪，加载面板');
    if (mainWindow) mainWindow.loadURL('http://127.0.0.1:3000');
  } catch (err) {
    console.error('[App] 启动失败:', err.message);
    if (mainWindow) {
      mainWindow.loadURL(loadingHTML(
        '服务启动失败: ' + err.message + '<br>请确保端口 3000 未被占用', true
      ));
    }
  }
});

app.on('window-all-closed', () => {
  // 不退出 —— 托盘常驻
});

app.on('before-quit', () => {
  isQuitting = true;
  stopServer();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});
