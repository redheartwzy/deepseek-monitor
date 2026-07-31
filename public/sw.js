// DeepSeek Monitor - Service Worker v5
// 模块九：预留 Web Push（VAPID）接收端；需配合后端 web-push 服务使用（可选）。
const CACHE = 'ds-monitor-v5';
const STATIC = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/js/main.js',
  '/js/api.js',
  '/js/config.js',
  '/js/storage.js',
  '/js/notify.js',
  '/js/chart.js',
  '/js/ui.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )),
      // 立即接管所有已打开的页面，避免仍用旧缓存里的页面
      self.clients.claim()
    ])
  );
});

// 全部「网络优先、离线回退缓存」：API 不缓存，页面与静态资源一律优先走网络，
// 确保新部署的 JS / HTML 立即生效（修复旧缓存导致登录按钮等无响应的问题）；
// 离线时才回退到已缓存副本。
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(r => r || new Response('Offline', { status: 503 }))
    )
  );
});

// ===== 模块九：Web Push（可选，需 VAPID + 推送服务）=====
self.addEventListener('push', e => {
  let data = { title: 'DeepSeek Monitor', body: '余额提醒' };
  try {
    if (e.data) data = Object.assign(data, e.data.json());
  } catch { /* 非 JSON 载荷 */ }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'dsm-push',
      vibrate: [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
