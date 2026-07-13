// ============================================
// 云同步模块 - 与 Cloudflare Worker 通信
// ============================================

var Sync = (function() {

  // ===== 配置 =====
  // 默认后端地址（已部署）
  var DEFAULT_API = 'https://gaokao-vocab-sync.goodniuniu.workers.dev';
  var API_BASE = localStorage.getItem('gev_api_base') || DEFAULT_API;

  // 同步码本地存储 key
  var SYNC_CODE_KEY = 'gev_sync_code';
  var SYNC_NAME_KEY = 'gev_sync_name';

  // 自动同步间隔（毫秒）- 2分钟
  var AUTO_SYNC_INTERVAL = 2 * 60 * 1000;
  var autoSyncTimer = null;

  // 待同步标记
  var pendingSync = false;

  // ===== 基础工具 =====
  function isConfigured() {
    return API_BASE && API_BASE.length > 0;
  }

  function getSyncCode() {
    return localStorage.getItem(SYNC_CODE_KEY) || '';
  }

  function setSyncCode(code) {
    if (code) localStorage.setItem(SYNC_CODE_KEY, code);
    else localStorage.removeItem(SYNC_CODE_KEY);
  }

  function getSyncName() {
    return localStorage.getItem(SYNC_NAME_KEY) || '';
  }

  function setSyncName(name) {
    if (name) localStorage.setItem(SYNC_NAME_KEY, name);
    else localStorage.removeItem(SYNC_NAME_KEY);
  }

  function setApiBase(url) {
    url = url ? url.replace(/\/+$/, '') : '';
    localStorage.setItem('gev_api_base', url);
    API_BASE = url;
  }

  function getApiBase() {
    return API_BASE;
  }

  async function apiCall(path, options) {
    if (!isConfigured()) {
      throw new Error('未配置同步服务器地址');
    }
    var url = API_BASE + path;
    var opts = options || {};
    opts.headers = opts.headers || {};
    opts.headers['Content-Type'] = 'application/json';

    var resp = await fetch(url, opts);
    var data = await resp.json();

    if (!resp.ok && !data.ok) {
      throw new Error(data.error || ('HTTP ' + resp.status));
    }
    return data;
  }

  // ===== 注册新云端用户 =====
  async function register(name) {
    var data = await apiCall('/api/register', {
      method: 'POST',
      body: JSON.stringify({ name: name })
    });

    if (data.ok) {
      setSyncCode(data.syncCode);
      setSyncName(name);
      // 将本地数据上传
      await uploadAll();
    }
    return data;
  }

  // ===== 检查同步码是否存在 =====
  async function checkCode(code) {
    return await apiCall('/api/check/' + code, { method: 'GET' });
  }

  // ===== 从云端拉取数据并合并到本地 =====
  async function pull(code) {
    var data = await apiCall('/api/data/' + code, { method: 'GET' });
    if (!data.ok) throw new Error(data.error || '拉取失败');

    setSyncCode(code);
    setSyncName(data.name);

    // 将云端数据写入本地
    if (data.data) {
      var d = data.data;
      // 需要为这个用户创建本地存储
      var uid = Storage.getCurrentUser();
      if (!uid) {
        uid = Storage.createUser(data.name);
        Storage.setCurrentUser(uid);
      }

      Storage.setSRSData(d.srs || {});
      Storage.setWrongBook(d.wrong || {});
      Storage.setBestScores(d.best || {});
      Storage.setDoneCount(d.done || 0);
      Storage.setCustomWords(d.custom || []);
      Storage.setDailyProgress(d.daily || { date: '', count: 0, goal: 20 });

      if (d.settings) {
        var settings = Storage.getSettings();
        Object.assign(settings, d.settings);
        Storage.setSettings(settings);
      }
    }

    return data;
  }

  // ===== 上传所有本地数据到云端 =====
  async function uploadAll() {
    var code = getSyncCode();
    if (!code) return { ok: false, error: '无同步码' };

    var payload = {
      srs: Storage.getSRSData(),
      wrong: Storage.getWrongBook(),
      best: Storage.getBestScores(),
      done: Storage.getDoneCount(),
      custom: Storage.getCustomWords(),
      daily: Storage.getDailyProgress(),
      settings: Storage.getSettings(),
    };

    return await apiCall('/api/sync/' + code, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // ===== 标记需要同步（防抖） =====
  function markPending() {
    if (!isConfigured() || !getSyncCode()) return;
    pendingSync = true;
  }

  // ===== 执行同步（如果有待同步数据） =====
  async function doSyncIfPending() {
    if (!pendingSync) return;
    pendingSync = false;
    try {
      await uploadAll();
    } catch(e) {
      // 同步失败，标记回来下次再试
      pendingSync = true;
      console.warn('同步失败:', e.message);
    }
  }

  // ===== 启动自动同步 =====
  function startAutoSync() {
    stopAutoSync();
    if (!isConfigured() || !getSyncCode()) return;

    autoSyncTimer = setInterval(function() {
      doSyncIfPending();
    }, AUTO_SYNC_INTERVAL);

    // 页面关闭前同步
    window.addEventListener('beforeunload', function() {
      if (pendingSync) {
        // 用 sendBeacon 尝试同步
        try {
          var payload = JSON.stringify({
            srs: Storage.getSRSData(),
            wrong: Storage.getWrongBook(),
            best: Storage.getBestScores(),
            done: Storage.getDoneCount(),
            custom: Storage.getCustomWords(),
            daily: Storage.getDailyProgress(),
            settings: Storage.getSettings(),
          });
          navigator.sendBeacon(
            API_BASE + '/api/sync/' + getSyncCode(),
            new Blob([payload], { type: 'application/json' })
          );
        } catch(e) {}
      }
    });
  }

  function stopAutoSync() {
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
  }

  // ===== 断开同步 =====
  function disconnect() {
    setSyncCode('');
    setSyncName('');
    stopAutoSync();
    pendingSync = false;
  }

  return {
    isConfigured: isConfigured,
    getApiBase: getApiBase,
    setApiBase: setApiBase,
    getSyncCode: getSyncCode,
    setSyncCode: setSyncCode,
    getSyncName: getSyncName,
    register: register,
    checkCode: checkCode,
    pull: pull,
    uploadAll: uploadAll,
    markPending: markPending,
    doSyncIfPending: doSyncIfPending,
    startAutoSync: startAutoSync,
    stopAutoSync: stopAutoSync,
    disconnect: disconnect,
  };
})();
