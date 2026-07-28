"""
限流模块 - 固定窗口计数（与原 Worker isRateLimited 等价）

按 IP + 分钟桶 计数，KV 中存 'rl:{ip}:{bucket}' 键。
设计参考原 Worker：
  - 敏感接口（check/register/data）加限流
  - 常规 /api/sync 不限（靠 baseSync 冲突检测保护，避免耗 KV 写额度）
"""

from __future__ import annotations
import time
from typing import Tuple

import db


def _client_ip(request) -> str:
    """提取客户端 IP（经过反代时取 X-Forwarded-For / X-Real-IP）"""
    # Caddy/nginx 反代时会设置这些头
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # X-Forwarded-For 可能是 "client, proxy1, proxy2"，取第一个
        return xff.split(",")[0].strip()
    xri = request.headers.get("x-real-ip")
    if xri:
        return xri.strip()
    # 直连（开发环境）回退到 request.client.host
    if request.client:
        return request.client.host
    return "unknown"


def is_rate_limited(request, limit_per_minute: int) -> Tuple[bool, int]:
    """
    检查并自增计数

    返回 (是否被限流, 当前计数)。
    """
    ip = _client_ip(request)
    bucket = int(time.time() // 60)  # 分钟桶
    key = f"rl:{ip}:{bucket}"
    return db.increment_with_limit(key, limit_per_minute, ttl=180)
