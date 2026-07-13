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
