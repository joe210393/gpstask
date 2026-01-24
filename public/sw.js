// Service Worker for GPS Task System
// 負責推送通知與快取管理

// bump this to force clients to drop old cached assets (prevents "I fixed it but nothing changes")
const CACHE_NAME = 'gps-task-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/map.html',
  '/tasks-list.html',
  '/css/style.css',
  '/js/common.js',
  '/images/mascot.png',
  '/images/flag-red.png'
];

// 安裝 Service Worker
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Service Worker: 快取已開啟');
        return cache.addAll(urlsToCache);
      })
      .catch(function(err) {
        console.error('Service Worker: 快取失敗', err);
      })
  );
  self.skipWaiting(); // 立即啟用新的 Service Worker
});

// 啟用 Service Worker
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: 刪除舊快取', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim(); // 立即控制所有頁面
});

// 攔截網路請求（快取策略）
self.addEventListener('fetch', function(event) {
  const req = event.request;
  const url = new URL(req.url);

  // 不快取 API / 非 GET（避免干擾後端與表單）
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  // 對 HTML/CSS/JS 採用 network-first，避免「部署了但手機永遠吃舊 JS」導致動畫/結果永遠不更新
  if (
    url.pathname.endsWith('.html') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/css/')
  ) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // 其他靜態資源維持 cache-first
  event.respondWith(
    caches.match(req).then((response) => response || fetch(req))
  );
});

// 監聽推送事件
self.addEventListener('push', function(event) {
  console.log('Service Worker: 收到推送通知');
  
  let data = {
    title: '新任務！',
    body: '附近有新的挑戰等著你',
    icon: '/images/mascot.png',
    badge: '/images/flag-red.png',
    url: '/map.html'
  };

  if (event.data) {
    try {
      const pushData = event.data.json();
      data = { ...data, ...pushData };
    } catch (e) {
      // 如果不是 JSON，嘗試解析為文字
      data.body = event.data.text() || data.body;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/images/mascot.png',
    badge: data.badge || '/images/flag-red.png',
    vibrate: [100, 50, 100],
    tag: data.tag || 'gps-task-notification',
    requireInteraction: false,
    data: {
      url: data.url || '/map.html',
      taskId: data.taskId || null
    },
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// 監聽通知點擊
self.addEventListener('notificationclick', function(event) {
  console.log('Service Worker: 通知被點擊', event.notification.data);
  
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/map.html';
  const taskId = event.notification.data?.taskId;

  // 構建完整的 URL（包含 taskId 如果有的話）
  let fullUrl = urlToOpen;
  if (taskId && urlToOpen.includes('task-detail.html')) {
    fullUrl = `${urlToOpen}?id=${taskId}`;
  }

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(function(clientList) {
      // 如果已經有打開的視窗，聚焦它
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === fullUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // 否則打開新視窗
      if (clients.openWindow) {
        return clients.openWindow(fullUrl);
      }
    })
  );
});

// 監聽通知關閉
self.addEventListener('notificationclose', function(event) {
  console.log('Service Worker: 通知被關閉', event.notification.tag);
});

