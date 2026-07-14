/**
 * 高考英语单词练习 - Cloudflare Worker 后端
 * 提供用户注册、数据同步 API
 * 数据存储在 Cloudflare KV 中
 */

// CORS 头
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  ...CORS_HEADERS,
};

// JSON 响应
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

// 生成同步码（6位字母数字，易记忆）
function generateSyncCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 IO01
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// 生成用户 ID
function generateUserId() {
  return 'u_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
}

// 验证同步码格式
function isValidSyncCode(code) {
  return /^[A-Z2-9]{6}$/.test(code);
}

// 同步恢复页面 HTML（内联，不走CDN缓存）
const SYNC_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>恢复学习数据</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#f0f2f5; color:#333; display:flex; justify-content:center; align-items:center; min-height:100vh; padding:20px; }
.card { background:#fff; border-radius:16px; padding:32px 24px; max-width:380px; width:100%; box-shadow:0 4px 24px rgba(0,0,0,0.08); text-align:center; }
.icon { font-size:48px; margin-bottom:12px; }
h1 { font-size:20px; margin-bottom:6px; }
.desc { font-size:14px; color:#888; margin-bottom:24px; line-height:1.5; }
input { width:100%; padding:14px; font-size:20px; text-align:center; letter-spacing:4px; border:2px solid #e0e0e0; border-radius:10px; text-transform:uppercase; margin-bottom:16px; }
input:focus { outline:none; border-color:#4f6df5; }
button { width:100%; padding:14px; font-size:16px; border:none; border-radius:10px; cursor:pointer; font-weight:600; transition:all .2s; }
.btn-primary { background:#4f6df5; color:#fff; }
.btn-primary:hover { background:#3d5de0; }
.btn-primary:disabled { background:#ccc; cursor:not-allowed; }
.result { margin-top:16px; padding:14px; border-radius:8px; font-size:14px; display:none; }
.result.success { background:#e8f5e9; color:#2e7d32; display:block; }
.result.error { background:#fbe9e7; color:#c62828; display:block; }
.result.loading { background:#e3f2fd; color:#1565c0; display:block; }
.stats { margin-top:12px; font-size:13px; color:#666; }
.stats div { margin:4px 0; }
.link { margin-top:20px; font-size:13px; }
.link a { color:#4f6df5; text-decoration:none; }
</style>
</head>
<body>
<div class="card">
<div class="icon">☁️</div>
<h1>恢复学习数据</h1>
<p class="desc">输入6位同步码，从云端恢复你的学习进度</p>
<input type="text" id="code" placeholder="同步码" maxlength="6" autocomplete="off" />
<button class="btn-primary" id="btn" onclick="doRestore()">恢复数据</button>
<div class="result" id="result"></div>
<div class="stats" id="stats" style="display:none"></div>
<div class="link"><a href="https://goodniuniu.github.io/gaokao-english-vocab/">→ 前往单词练习</a></div>
</div>
<script>
var API_BASE = '';
function showResult(msg, type) {
  var el = document.getElementById('result');
  el.textContent = msg;
  el.className = 'result ' + type;
}
async function doRestore() {
  var code = document.getElementById('code').value.trim().toUpperCase();
  if (!code || code.length !== 6) { showResult('请输入6位同步码', 'error'); return; }
  var btn = document.getElementById('btn');
  btn.disabled = true;
  btn.textContent = '恢复中...';
  showResult('正在从云端拉取数据...', 'loading');
  try {
    var resp = await fetch('/api/data/' + code, { method: 'GET' });
    var text = await resp.text();
    var data;
    try { data = JSON.parse(text); } catch(e) {
      throw new Error('服务器返回异常，请稍后重试');
    }
    if (!resp.ok || data.ok === false) {
      throw new Error(data.error || '恢复失败 (HTTP ' + resp.status + ')');
    }
    showResult('数据拉取成功！正在写入本地...', 'loading');

    // 写入 localStorage（跟主应用相同的 key 格式）
    var PREFIX = 'gev_';
    var uid = 'u_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

    // 创建用户
    var users = JSON.parse(localStorage.getItem(PREFIX + 'users') || '{}');
    users[uid] = { id: uid, name: data.name, createdAt: Date.now() };
    localStorage.setItem(PREFIX + 'users', JSON.stringify(users));
    localStorage.setItem(PREFIX + 'current_user', uid);

    // 写入学习数据
    var d = data.data || {};
    localStorage.setItem(PREFIX + uid + '_srs', JSON.stringify(d.srs || {}));
    localStorage.setItem(PREFIX + uid + '_wrong', JSON.stringify(d.wrong || {}));
    localStorage.setItem(PREFIX + uid + '_best', JSON.stringify(d.best || {}));
    localStorage.setItem(PREFIX + uid + '_done', String(d.done || 0));
    localStorage.setItem(PREFIX + uid + '_custom', JSON.stringify(d.custom || []));
    localStorage.setItem(PREFIX + uid + '_daily', JSON.stringify(d.daily || {date:'',count:0,goal:20}));

    // 保存同步码
    localStorage.setItem(PREFIX + 'sync_code', code);
    localStorage.setItem(PREFIX + 'sync_name', data.name);

    // 显示统计
    var stats = document.getElementById('stats');
    stats.innerHTML = '<div>用户: <b>' + data.name + '</b></div>'
      + '<div>SRS 记录: <b>' + Object.keys(d.srs||{}).length + '</b> 个单词</div>'
      + '<div>已练习: <b>' + (d.done||0) + '</b> 题</div>'
      + '<div>今日进度: <b>' + (d.daily ? d.daily.count : 0) + '/' + (d.daily ? d.daily.goal : 20) + '</b></div>';
    stats.style.display = 'block';

    showResult('恢复成功！点击下方链接开始学习', 'success');
    btn.textContent = '前往单词练习';
    btn.disabled = false;
    btn.onclick = function() { window.location.href = 'https://goodniuniu.github.io/gaokao-english-vocab/'; };
  } catch(e) {
    console.error('恢复失败:', e);
    showResult(e.message, 'error');
    btn.disabled = false;
    btn.textContent = '恢复数据';
  }
}
document.getElementById('code').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') doRestore();
});
document.getElementById('code').focus();
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 处理 CORS 预检
    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // 健康检查
    if (path === '/' || path === '/api/health') {
      return json({ ok: true, service: 'gaokao-english-vocab-sync', time: Date.now() });
    }

    // ---- 同步恢复页面（不走CDN缓存，确保最新） ----
    if (path === '/sync') {
      var html = SYNC_PAGE_HTML;
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          ...CORS_HEADERS,
        },
      });
    }

    // ---- 注册新用户 ----
    // POST /api/register
    // body: { name: string }
    // 返回: { syncCode, userId }
    if (path === '/api/register' && method === 'POST') {
      try {
        const body = await request.json();
        const name = (body.name || '学生').toString().slice(0, 20);

        // 生成唯一同步码（最多重试5次）
        let syncCode, attempts = 0;
        do {
          syncCode = generateSyncCode();
          attempts++;
          const existing = await env.VOCAB_KV.get('code:' + syncCode);
          if (!existing) break;
        } while (attempts < 5);

        const userId = generateUserId();
        const userData = {
          userId,
          name,
          syncCode,
          createdAt: Date.now(),
        };

        // 存储同步码到 userId 的映射
        await env.VOCAB_KV.put('code:' + syncCode, JSON.stringify(userData));

        // 初始化空数据
        const emptyData = {
          srs: {},
          wrong: {},
          best: {},
          done: 0,
          custom: [],
          daily: { date: '', count: 0, goal: 20 },
          streak: { current: 0, best: 0, lastDate: '' },
          settings: { autoSpeak: false, keyboardShortcuts: true, dailyGoal: 20 },
          lastSync: Date.now(),
        };
        await env.VOCAB_KV.put('data:' + syncCode, JSON.stringify(emptyData));

        return json({ ok: true, syncCode, userId, name });
      } catch (e) {
        return json({ ok: false, error: '注册失败: ' + e.message }, 500);
      }
    }

    // ---- 用同步码登录/获取数据 ----
    // GET /api/data/:syncCode
    // 返回: { ok, name, data }
    const dataMatch = path.match(/^\/api\/data\/([A-Z2-9]{6})$/);
    if (dataMatch && method === 'GET') {
      try {
        const syncCode = dataMatch[1];
        const userMeta = await env.VOCAB_KV.get('code:' + syncCode);
        if (!userMeta) {
          return json({ ok: false, error: '同步码不存在' }, 404);
        }
        const meta = JSON.parse(userMeta);
        const dataStr = await env.VOCAB_KV.get('data:' + syncCode);
        const data = dataStr ? JSON.parse(dataStr) : null;

        return json({
          ok: true,
          name: meta.name,
          userId: meta.userId,
          createdAt: meta.createdAt,
          data,
        });
      } catch (e) {
        return json({ ok: false, error: '获取数据失败: ' + e.message }, 500);
      }
    }

    // ---- 上传/同步数据 ----
    // POST /api/sync/:syncCode
    // body: { srs, wrong, best, done, custom, daily, settings }
    // 返回: { ok, lastSync }
    const syncMatch = path.match(/^\/api\/sync\/([A-Z2-9]{6})$/);
    if (syncMatch && method === 'POST') {
      try {
        const syncCode = syncMatch[1];
        const userMeta = await env.VOCAB_KV.get('code:' + syncCode);
        if (!userMeta) {
          return json({ ok: false, error: '同步码不存在' }, 404);
        }

        const body = await request.json();
        const now = Date.now();

        const dataToSave = {
          srs: body.srs || {},
          wrong: body.wrong || {},
          best: body.best || {},
          done: body.done || 0,
          custom: body.custom || [],
          daily: body.daily || { date: '', count: 0, goal: 20 },
          streak: body.streak || { current: 0, best: 0, lastDate: '' },
          settings: body.settings || {},
          lastSync: now,
        };

        await env.VOCAB_KV.put('data:' + syncCode, JSON.stringify(dataToSave));

        return json({ ok: true, lastSync: now });
      } catch (e) {
        return json({ ok: false, error: '同步失败: ' + e.message }, 500);
      }
    }

    // ---- 检查同步码是否存在 ----
    // GET /api/check/:syncCode
    // 返回: { ok, exists, name }
    const checkMatch = path.match(/^\/api\/check\/([A-Z2-9]{6})$/);
    if (checkMatch && method === 'GET') {
      try {
        const syncCode = checkMatch[1];
        const userMeta = await env.VOCAB_KV.get('code:' + syncCode);
        if (!userMeta) {
          return json({ ok: true, exists: false });
        }
        const meta = JSON.parse(userMeta);
        return json({ ok: true, exists: true, name: meta.name });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // 404
    return json({ ok: false, error: 'Not found: ' + path }, 404);
  },
};
