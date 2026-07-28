"""
高考英语单词练习 - FastAPI 后端主入口

从 Cloudflare Worker (worker/src/index.js) 一比一翻译。
功能、路由、错误码、限流策略、数据格式全部保持兼容。

启动：
  开发：uvicorn main:app --reload --host 0.0.0.0 --port 8000
  生产：systemd 拉起 gunicorn/uvicorn，监听 127.0.0.1:8000
       前面用 Caddy/nginx 反代 + 自动 HTTPS
"""

from __future__ import annotations
import json
import secrets
import time
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

import db
import merge
from config import settings
from models import RegisterRequest, SyncPayload
from rate_limit import is_rate_limited


# ====================  初始化  ====================

app = FastAPI(
    title="高考英语单词练习 API",
    description="从 Cloudflare Worker 迁移而来。功能、路由、数据格式与原 Worker 完全兼容。",
    version="2.0.0",
    docs_url="/docs",       # 生产环境可关闭：docs_url=None
    redoc_url=None,
)

# 启动时初始化数据库
@app.on_event("startup")
def _startup() -> None:
    db.init_db()
    # 启动时清理一次过期限流键（可选，降低冷启动后查询压力）
    try:
        db.cleanup_expired()
    except Exception as e:
        # 清理失败不影响启动
        print(f"[startup] cleanup_expired 失败（忽略）: {e}")


# ====================  工具函数  ====================

def _json(body: Dict[str, Any], status_code: int = 200) -> JSONResponse:
    """统一 JSON 响应（保留 ok 字段约定）"""
    return JSONResponse(content=body, status_code=status_code)


def _generate_sync_code() -> str:
    """
    生成 6 位同步码（与原 Worker generateSyncCode 等价）
    - 字符集：去掉易混淆的 IO01
    - 使用 secrets 加密安全随机
    """
    chars = settings.sync_code_chars
    return "".join(secrets.choice(chars) for _ in range(settings.sync_code_length))


def _generate_user_id() -> str:
    """生成用户 ID（与原 Worker 一致：u_{ts}_{rand}）"""
    return f"u_{int(time.time() * 1000)}_{secrets.randbelow(10000)}"


def _is_valid_sync_code(code: str) -> bool:
    """同步码格式校验"""
    import re
    return bool(re.match(r"^[A-Z2-9]{6}$", code))


def _check_origin(origin: Optional[str]) -> bool:
    """
    Origin 白名单检查（兼容原 Worker 的安全模型 + null 放行）

    规则（与已修复的 worker/src/index.js 一致）：
      - 未配置白名单（空列表）→ 放行
      - Origin 头缺失 → 放行（curl 等非浏览器请求）
      - Origin: null（PWA / 微信 / 隐私模式等合法场景）→ 放行
      - Origin 在白名单内 → 放行
      - localhost / 127.0.0.1 → 放行（本地开发）
      - 其他 → 拒绝
    """
    if not settings.allowed_origins:
        return True
    if not origin or origin == "null":
        return True
    if origin in settings.allowed_origins:
        return True
    import re
    if re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", origin):
        return True
    return False


# ====================  Origin 白名单门禁（前置中间件）  ====================

@app.middleware("http")
async def origin_gate(request: Request, call_next):
    """
    与 worker/src/index.js:218-238 行为一致。
    对所有请求先做 Origin 检查（CORS 预检 OPTIONS 不拦截）。
    """
    origin = request.headers.get("origin")

    # CORS 预检直接放行（让 CORSMiddleware 处理）
    if request.method == "OPTIONS":
        return await call_next(request)

    if origin and not _check_origin(origin):
        return _json({"ok": False, "error": "Origin not allowed"}, status.HTTP_403_FORBIDDEN)

    return await call_next(request)


# CORS：允许携带 Origin 头跨域（具体白名单由 origin_gate 把关）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # 实际白名单在 origin_gate 中过滤
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    max_age=86400,
)


# ====================  路由  ====================

@app.get("/", tags=["health"])
@app.get("/api/health", tags=["health"])
def health():
    """健康检查"""
    return _json({
        "ok": True,
        "service": "gaokao-english-vocab-sync",
        "backend": "fastapi",
        "time": int(time.time() * 1000),
    })


# ------------------  同步恢复页面（与 worker 内嵌 HTML 一致） ------------------

SYNC_PAGE_HTML = """<!DOCTYPE html>
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
<div class="link"><a href="https://www.goodniuniu.com/gaokao-english-vocab/">→ 前往单词练习</a></div>
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

    var PREFIX = 'gev_';
    var uid = 'u_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    var users = JSON.parse(localStorage.getItem(PREFIX + 'users') || '{}');
    users[uid] = { id: uid, name: data.name, createdAt: Date.now() };
    localStorage.setItem(PREFIX + 'users', JSON.stringify(users));
    localStorage.setItem(PREFIX + 'current_user', uid);

    var d = data.data || {};
    localStorage.setItem(PREFIX + uid + '_srs', JSON.stringify(d.srs || {}));
    localStorage.setItem(PREFIX + uid + '_wrong', JSON.stringify(d.wrong || {}));
    localStorage.setItem(PREFIX + uid + '_best', JSON.stringify(d.best || {}));
    localStorage.setItem(PREFIX + uid + '_done', String(d.done || 0));
    localStorage.setItem(PREFIX + uid + '_custom', JSON.stringify(d.custom || []));
    localStorage.setItem(PREFIX + uid + '_daily', JSON.stringify(d.daily || {date:'',count:0,goal:20}));
    localStorage.setItem(PREFIX + 'sync_code', code);
    localStorage.setItem(PREFIX + 'sync_name', data.name);

    var stats = document.getElementById('stats');
    stats.innerHTML = '<div>用户: <b>' + data.name + '</b></div>'
      + '<div>SRS 记录: <b>' + Object.keys(d.srs||{}).length + '</b> 个单词</div>'
      + '<div>已练习: <b>' + (d.done||0) + '</b> 题</div>'
      + '<div>今日进度: <b>' + (d.daily ? d.daily.count : 0) + '/' + (d.daily ? d.daily.goal : 20) + '</b></div>';
    stats.style.display = 'block';

    showResult('恢复成功！点击下方链接开始学习', 'success');
    btn.textContent = '前往单词练习';
    btn.disabled = false;
    btn.onclick = function() { window.location.href = 'https://www.goodniuniu.com/gaokao-english-vocab/'; };
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
</html>"""


@app.get("/sync", response_class=HTMLResponse, tags=["sync"])
def sync_restore_page():
    """同步恢复页面（与原 Worker 内嵌 HTML 等价，已更新跳转域名）"""
    return HTMLResponse(
        content=SYNC_PAGE_HTML,
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


# ------------------  注册新用户  ------------------

@app.post("/api/register", tags=["sync"])
def register(body: RegisterRequest, request: Request):
    """
    与原 Worker POST /api/register 一致
    body: { name: string }
    返回: { ok, syncCode, userId, name, lastSync }
    """
    # 限流
    blocked, _ = is_rate_limited(request, settings.rate_limit_register)
    if blocked:
        return _json(
            {"ok": False, "error": "请求过于频繁，请稍后再试"},
            status.HTTP_429_TOO_MANY_REQUESTS,
        )

    name = body.name or "学生"

    # 生成唯一同步码（最多重试 5 次）
    sync_code = None
    for _ in range(5):
        candidate = _generate_sync_code()
        if db.get(f"code:{candidate}") is None:
            sync_code = candidate
            break
    if sync_code is None:
        return _json(
            {"ok": False, "error": "同步码生成失败，请重试"},
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    user_id = _generate_user_id()
    now_ms = int(time.time() * 1000)

    # 元数据（与原 Worker 字段完全一致）
    user_meta = {
        "userId": user_id,
        "name": name,
        "syncCode": sync_code,
        "createdAt": now_ms,
    }
    db.put(f"code:{sync_code}", json.dumps(user_meta, ensure_ascii=False))

    # 初始化空数据（与原 Worker emptyData 结构一致）
    empty_data = {
        "srs": {},
        "wrong": {},
        "best": {},
        "done": 0,
        "custom": [],
        "daily": {"date": "", "count": 0, "goal": 20},
        "streak": {"current": 0, "best": 0, "lastDate": ""},
        "settings": {"autoSpeak": False, "keyboardShortcuts": True, "dailyGoal": 20},
        "lastSync": now_ms,
    }
    db.put(f"data:{sync_code}", json.dumps(empty_data, ensure_ascii=False))

    return _json({
        "ok": True,
        "syncCode": sync_code,
        "userId": user_id,
        "name": name,
        "lastSync": now_ms,
    })


# ------------------  获取数据  ------------------

@app.get("/api/data/{sync_code}", tags=["sync"])
def get_data(sync_code: str, request: Request):
    """
    与原 Worker GET /api/data/:syncCode 一致
    返回: { ok, name, userId, createdAt, data }
    """
    if not _is_valid_sync_code(sync_code):
        return _json({"ok": False, "error": "同步码格式错误"}, status.HTTP_400_BAD_REQUEST)

    blocked, _ = is_rate_limited(request, settings.rate_limit_data)
    if blocked:
        return _json(
            {"ok": False, "error": "请求过于频繁，请稍后再试"},
            status.HTTP_429_TOO_MANY_REQUESTS,
        )

    meta_str = db.get(f"code:{sync_code}")
    if meta_str is None:
        return _json({"ok": False, "error": "同步码不存在"}, status.HTTP_404_NOT_FOUND)

    try:
        meta = json.loads(meta_str)
    except json.JSONDecodeError:
        return _json(
            {"ok": False, "error": "数据损坏"},
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    data_str = db.get(f"data:{sync_code}")
    data = json.loads(data_str) if data_str else None

    return _json({
        "ok": True,
        "name": meta.get("name"),
        "userId": meta.get("userId"),
        "createdAt": meta.get("createdAt"),
        "data": data,
    })


# ------------------  上传/同步数据  ------------------

@app.post("/api/sync/{sync_code}", tags=["sync"])
async def upload_sync(sync_code: str, request: Request):
    """
    与原 Worker POST /api/sync/:syncCode 一致
    body: SyncPayload (srs/wrong/best/done/custom/daily/streak/settings/baseSync)
    返回: { ok, lastSync }；冲突时 409 { ok:false, code:'conflict', lastSync }
    """
    if not _is_valid_sync_code(sync_code):
        return _json({"ok": False, "error": "同步码格式错误"}, status.HTTP_400_BAD_REQUEST)

    meta_str = db.get(f"code:{sync_code}")
    if meta_str is None:
        return _json({"ok": False, "error": "同步码不存在"}, status.HTTP_404_NOT_FOUND)

    # 大小限制（与原 Worker MAX_BODY_BYTES 一致）
    content_length = int(request.headers.get("content-length") or 0)
    if content_length > settings.max_body_bytes:
        return _json(
            {"ok": False, "error": "数据过大，超过 1MB 上限"},
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )

    # 读取并解析 body
    try:
        raw = await request.body()
    except Exception as e:
        return _json({"ok": False, "error": f"读取请求体失败: {e}"}, status.HTTP_400_BAD_REQUEST)

    if len(raw) > settings.max_body_bytes:
        return _json(
            {"ok": False, "error": "数据过大，超过 1MB 上限"},
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )

    try:
        body_dict = json.loads(raw)
    except json.JSONDecodeError:
        return _json(
            {"ok": False, "error": "请求体不是合法的 JSON"},
            status.HTTP_400_BAD_REQUEST,
        )

    # 用 Pydantic 校验字段类型/大小（替代原 Worker validateSyncBody）
    try:
        body = SyncPayload.model_validate(body_dict)
    except Exception as e:
        # e 是 ValidationError，errors() 返回详细字段错误
        from pydantic import ValidationError
        if isinstance(e, ValidationError):
            detail = "; ".join(
                f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}"
                for err in e.errors()
            )
        else:
            detail = str(e)
        return _json(
            {"ok": False, "error": f"数据校验失败: {detail}"},
            status.HTTP_400_BAD_REQUEST,
        )

    # 冲突检测：云端 lastSync 若大于客户端 baseSync，拒绝覆盖
    existing_str = db.get(f"data:{sync_code}")
    existing = json.loads(existing_str) if existing_str else None
    base_sync = body.baseSync
    if (
        base_sync is not None
        and existing is not None
        and isinstance(existing.get("lastSync"), (int, float))
        and existing["lastSync"] > base_sync
    ):
        return _json(
            {
                "ok": False,
                "code": "conflict",
                "error": "云端数据已被其他设备更新",
                "lastSync": existing["lastSync"],
            },
            status.HTTP_409_CONFLICT,
        )

    now_ms = int(time.time() * 1000)

    # 存储数据（默认值与原 Worker dataToSave 一致）
    data_to_save = {
        "srs": body.srs or {},
        "wrong": body.wrong or {},
        "best": body.best or {},
        "done": body.done or 0,
        "custom": body.custom or [],
        "daily": body.daily or {"date": "", "count": 0, "goal": 20},
        "streak": body.streak or {"current": 0, "best": 0, "lastDate": ""},
        "settings": body.settings or {},
        "lastSync": now_ms,
    }
    db.put(f"data:{sync_code}", json.dumps(data_to_save, ensure_ascii=False))

    return _json({"ok": True, "lastSync": now_ms})


# ------------------  检查同步码是否存在  ------------------

@app.get("/api/check/{sync_code}", tags=["sync"])
def check_sync_code(sync_code: str, request: Request):
    """
    与原 Worker GET /api/check/:syncCode 一致
    返回: { ok, exists }（不回显用户名，避免用户枚举）
    """
    if not _is_valid_sync_code(sync_code):
        return _json({"ok": False, "error": "同步码格式错误"}, status.HTTP_400_BAD_REQUEST)

    blocked, _ = is_rate_limited(request, settings.rate_limit_check)
    if blocked:
        return _json(
            {"ok": False, "error": "请求过于频繁，请稍后再试"},
            status.HTTP_429_TOO_MANY_REQUESTS,
        )

    exists = db.get(f"code:{sync_code}") is not None
    return _json({"ok": True, "exists": exists})


# ====================  开发运行入口  ====================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        log_level="info",
    )
