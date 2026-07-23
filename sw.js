// ============================================
// Service Worker — 离线缓存 (PWA)
// ============================================
// CACHE_VERSION 和 PRECACHE_LIST 两个占位符由 build.js 构建时注入：
//   - 版本号 = 全部静态资源内容哈希，文件一变缓存即整体换新
//   - 预缓存清单 = dist 内全部资源（js/css 带 ?v=hash）
// 开发环境（未构建直接打开）时占位符不生效，SW 退化为仅运行时缓存。
// ============================================

const CACHE_VERSION = '__CACHE_VERSION__';
const CACHE_NAME = 'gev-' + CACHE_VERSION;
const PRECACHE = __PRECACHE_LIST__;

// 安装：预缓存全部静态资源
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(PRECACHE); })
      .then(function() { return self.skipWaiting(); })
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(keys.map(function(key) {
          if (key.startsWith('gev-') && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        }));
      })
      .then(function() { return self.clients.claim(); })
  );
});

// 请求策略：
//   - 页面导航：网络优先（拿到最新 index.html），离线回退缓存
//   - 静态资源：缓存优先（?v=hash 保证内容变化即新 URL），未命中则网络并写入缓存
//   - 跨域请求（云同步 Worker API 等）：不拦截，直接走网络
self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(function(resp) {
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put('index.html', copy); });
          return resp;
        })
        .catch(function() {
          return caches.match('index.html').then(function(hit) {
            return hit || caches.match('./');
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then(function(hit) {
      if (hit) return hit;
      return fetch(req).then(function(resp) {
        if (resp.ok) {
          var copy = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        }
        return resp;
      });
    })
  );
});
