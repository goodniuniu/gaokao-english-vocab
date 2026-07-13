// ============================================
// 存储模块 - 本地用户系统 + SRS 学习数据
// ============================================

var Storage = (function() {

  var PREFIX = 'gev_';          // gaokao english vocab
  var USERS_KEY = PREFIX + 'users';
  var CURRENT_KEY = PREFIX + 'current_user';
  var THEME_KEY = PREFIX + 'theme';
  var SETTINGS_KEY = PREFIX + 'settings';

  // ---- 基础读写 ----
  function read(key) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    } catch(e) {
      return null;
    }
  }

  function write(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch(e) {
      return false;
    }
  }

  function remove(key) {
    localStorage.removeItem(key);
  }

  // ---- 用户管理 ----
  function getUsers() {
    return read(USERS_KEY) || {};
  }

  function getCurrentUser() {
    return localStorage.getItem(CURRENT_KEY) || null;
  }

  function setCurrentUser(id) {
    localStorage.setItem(CURRENT_KEY, id);
  }

  function createUser(name) {
    var users = getUsers();
    var id = 'u_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    users[id] = {
      id: id,
      name: name,
      createdAt: Date.now()
    };
    write(USERS_KEY, users);
    // 初始化用户数据
    write(PREFIX + id + '_srs', {});
    write(PREFIX + id + '_wrong', {});
    write(PREFIX + id + '_best', {});
    write(PREFIX + id + '_done', 0);
    write(PREFIX + id + '_custom', []);
    write(PREFIX + id + '_daily', { date: '', count: 0, goal: 20 });
    return id;
  }

  function deleteUser(id) {
    var users = getUsers();
    delete users[id];
    write(USERS_KEY, users);
    remove(PREFIX + id + '_srs');
    remove(PREFIX + id + '_wrong');
    remove(PREFIX + id + '_best');
    remove(PREFIX + id + '_done');
    remove(PREFIX + id + '_custom');
    remove(PREFIX + id + '_daily');
    if (getCurrentUser() === id) {
      localStorage.removeItem(CURRENT_KEY);
    }
  }

  function renameUser(id, newName) {
    var users = getUsers();
    if (users[id]) {
      users[id].name = newName;
      write(USERS_KEY, users);
    }
  }

  // ---- 用户学习数据 ----
  function userKey(suffix) {
    var uid = getCurrentUser();
    return uid ? PREFIX + uid + '_' + suffix : null;
  }

  function getSRSData() {
    var k = userKey('srs');
    return k ? (read(k) || {}) : {};
  }

  function setSRSData(data) {
    var k = userKey('srs');
    if (k) write(k, data);
  }

  function getWrongBook() {
    var k = userKey('wrong');
    return k ? (read(k) || {}) : {};
  }

  function setWrongBook(data) {
    var k = userKey('wrong');
    if (k) write(k, data);
  }

  function getBestScores() {
    var k = userKey('best');
    return k ? (read(k) || {}) : {};
  }

  function setBestScores(data) {
    var k = userKey('best');
    if (k) write(k, data);
  }

  function getDoneCount() {
    var k = userKey('done');
    return k ? (parseInt(localStorage.getItem(k) || '0', 10)) : 0;
  }

  function setDoneCount(n) {
    var k = userKey('done');
    if (k) localStorage.setItem(k, String(n));
  }

  function getCustomWords() {
    var k = userKey('custom');
    return k ? (read(k) || []) : [];
  }

  function setCustomWords(data) {
    var k = userKey('custom');
    if (k) write(k, data);
  }

  function getDailyProgress() {
    var k = userKey('daily');
    return k ? (read(k) || { date: '', count: 0, goal: 20 }) : { date: '', count: 0, goal: 20 };
  }

  function setDailyProgress(data) {
    var k = userKey('daily');
    if (k) write(k, data);
  }

  // ---- 全局设置 ----
  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'light';
  }

  function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
  }

  function getSettings() {
    return read(SETTINGS_KEY) || {
      autoSpeak: false,
      keyboardShortcuts: true,
      dailyGoal: 20
    };
  }

  function setSettings(data) {
    write(SETTINGS_KEY, data);
  }

  return {
    // users
    getUsers: getUsers,
    getCurrentUser: getCurrentUser,
    setCurrentUser: setCurrentUser,
    createUser: createUser,
    deleteUser: deleteUser,
    renameUser: renameUser,
    // user data
    getSRSData: getSRSData,
    setSRSData: setSRSData,
    getWrongBook: getWrongBook,
    setWrongBook: setWrongBook,
    getBestScores: getBestScores,
    setBestScores: setBestScores,
    getDoneCount: getDoneCount,
    setDoneCount: setDoneCount,
    getCustomWords: getCustomWords,
    setCustomWords: setCustomWords,
    getDailyProgress: getDailyProgress,
    setDailyProgress: setDailyProgress,
    // global
    getTheme: getTheme,
    setTheme: setTheme,
    getSettings: getSettings,
    setSettings: setSettings
  };
})();
