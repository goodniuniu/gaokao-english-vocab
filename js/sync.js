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
  // 客户端最后一次见到的云端 lastSync（多设备冲突检测基线）
  var LAST_SYNC_KEY = 'gev_last_sync';

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

  function getLastSync() {
    return parseInt(localStorage.getItem(LAST_SYNC_KEY) || '0', 10);
  }

  function setLastSync(ts) {
    if (ts) localStorage.setItem(LAST_SYNC_KEY, String(ts));
    else localStorage.removeItem(LAST_SYNC_KEY);
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

    var resp;
    try {
      resp = await fetch(url, opts);
    } catch(netErr) {
      throw new Error('网络连接失败，请检查网络后重试 (' + netErr.message + ')');
    }

    // 先拿文本，避免非 JSON 响应导致 json() 抛异常
    var text = await resp.text();
    var data;
    try {
      data = JSON.parse(text);
    } catch(e) {
      throw new Error('服务器返回异常 (HTTP ' + resp.status + ')，请稍后重试');
    }

    if (!resp.ok || data.ok === false) {
      var err = new Error(data.error || ('请求失败 (HTTP ' + resp.status + ')'));
      err.status = resp.status;
      err.code = data.code || '';
      err.lastSync = data.lastSync || 0;
      throw err;
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
      if (data.lastSync) setLastSync(data.lastSync);
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

    setSyncCode(code);
    setSyncName(data.name);

    // 确保 localStorage 可用且有当前用户
    var uid = Storage.getCurrentUser();
    var users = Storage.getUsers();

    // 如果当前没有用户，或当前用户名跟云端不匹配，创建一个新用户
    if (!uid || !users[uid]) {
      uid = Storage.createUser(data.name || '同步用户');
      Storage.setCurrentUser(uid);
    } else {
      // 更新当前用户名为云端用户名
      Storage.renameUser(uid, data.name || users[uid].name);
    }

    // 将云端数据写入本地
    if (data.data) {
      var d = data.data;
      Storage.setSRSData(d.srs || {});
      Storage.setWrongBook(d.wrong || {});
      Storage.setBestScores(d.best || {});
      Storage.setDoneCount(d.done || 0);
      Storage.setCustomWords(d.custom || []);
      Storage.setDailyProgress(d.daily || { date: '', count: 0, goal: 20 });
      Storage.setStreak(d.streak || { current: 0, best: 0, lastDate: '' });

      if (d.settings) {
        var settings = Storage.getSettings();
        Object.assign(settings, d.settings);
        Storage.setSettings(settings);
      }

      // 记录云端版本基线，供后续上传做冲突检测
      if (d.lastSync) setLastSync(d.lastSync);
    } else {
      // 云端没有数据，初始化空数据
      Storage.setSRSData({});
      Storage.setWrongBook({});
      Storage.setBestScores({});
      Storage.setDoneCount(0);
      Storage.setCustomWords([]);
      Storage.setDailyProgress({ date: '', count: 0, goal: 20 });
      Storage.setStreak({ current: 0, best: 0, lastDate: '' });
    }

    return data;
  }

  // ===== 构造同步 payload（uploadAll 与 sendBeacon 共用）=====
  function buildPayload() {
    return {
      srs: Storage.getSRSData(),
      wrong: Storage.getWrongBook(),
      best: Storage.getBestScores(),
      done: Storage.getDoneCount(),
      custom: Storage.getCustomWords(),
      daily: Storage.getDailyProgress(),
      streak: Storage.getStreak(),
      settings: Storage.getSettings(),
      baseSync: getLastSync(), // 冲突检测基线
    };
  }

  // ===== 上传所有本地数据到云端 =====
  async function uploadAll() {
    var code = getSyncCode();
    if (!code) return { ok: false, error: '无同步码' };

    try {
      var data = await apiCall('/api/sync/' + code, {
        method: 'POST',
        body: JSON.stringify(buildPayload())
      });
      if (data.lastSync) setLastSync(data.lastSync);
      return data;
    } catch(e) {
      // 多设备冲突：拉取云端数据 → 与本地按字段合并 → 重传一次
      if (e.status === 409 && typeof SyncMerge !== 'undefined') {
        console.warn('检测到多设备数据冲突，自动合并...');
        return await resolveConflict(code);
      }
      throw e;
    }
  }

  // ===== 冲突处理：云端与本地合并后重新上传 =====
  async function resolveConflict(code) {
    // 拉取云端原始数据（不直接覆盖本地）
    var cloud = await apiCall('/api/data/' + code, { method: 'GET' });
    var cloudData = cloud.data || {};

    var merged = SyncMerge.mergeAll(buildPayload(), cloudData);

    // 合并结果写回本地存储，保持界面与云端一致
    Storage.setSRSData(merged.srs);
    Storage.setWrongBook(merged.wrong);
    Storage.setBestScores(merged.best);
    Storage.setDoneCount(merged.done);
    Storage.setCustomWords(merged.custom);
    Storage.setDailyProgress(merged.daily);
    Storage.setStreak(merged.streak);

    // 以云端 lastSync 为新基线重传
    if (cloudData.lastSync) setLastSync(cloudData.lastSync);
    var data = await apiCall('/api/sync/' + code, {
      method: 'POST',
      body: JSON.stringify(buildPayload())
    });
    if (data.lastSync) setLastSync(data.lastSync);
    return data;
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
          navigator.sendBeacon(
            API_BASE + '/api/sync/' + getSyncCode(),
            new Blob([JSON.stringify(buildPayload())], { type: 'application/json' })
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
    setLastSync(0);
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
    getLastSync: getLastSync,
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
