// DeepSeek Monitor - Service Worker v2
// 模块九：预留 Web Push（VAPID）接收端；需配合后端 web-push 服务使用（可选）。
const CACHE = 'ds-monitor-v2';
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
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
});

// Network-first for API, cache-first for static assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API 请求只走网络
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => {
      if (e.request.mode === 'navigate') return caches.match('/');
      return new Response('Offline', { status: 503 });
    }))
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
