"""
配置模块 - 从环境变量读取

部署时通过环境变量或 .env 文件配置。
本地开发默认值兼容原 Cloudflare Worker 行为。
"""

from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import List


def _parse_allowed_origins(raw: str) -> List[str]:
    """逗号分隔的 Origin 白名单 → 列表（去空白）"""
    if not raw or raw.strip() == "*":
        return []  # 空列表表示不限制
    return [s.strip() for s in raw.split(",") if s.strip()]


@dataclass
class Settings:
    # SQLite 数据库文件路径
    db_path: str = os.environ.get("VOCAB_DB_PATH", "/var/lib/gaokao-vocab/vocab.db")

    # 服务监听
    host: str = os.environ.get("VOCAB_HOST", "127.0.0.1")  # 仅本机，由前端的 Caddy/nginx 反代
    port: int = int(os.environ.get("VOCAB_PORT", "8000"))

    # Origin 白名单（与原 Worker wrangler.toml ALLOWED_ORIGINS 一致）
    # 逗号分隔；未配置或 "*" 表示不限制
    # 注意：上线后建议配置 https://www.goodniuniu.com（与前端同域则可省略）
    allowed_origins: List[str] = field(
        default_factory=lambda: _parse_allowed_origins(
            os.environ.get(
                "ALLOWED_ORIGINS",
                "https://goodniuniu.github.io,http://www.goodniuniu.com,"
                "https://www.goodniuniu.com,http://goodniuniu.com,https://goodniuniu.com",
            )
        )
    )

    # 各接口限流（每分钟每 IP）
    rate_limit_register: int = 5
    rate_limit_data: int = 20
    rate_limit_check: int = 10
    # sync 上传接口不限流（与原 Worker 一致），靠 baseSync 冲突检测保护

    # 请求体大小限制（与原 Worker MAX_BODY_BYTES 一致）
    max_body_bytes: int = 1024 * 1024  # 1MB

    # 自定义单词上限
    max_custom_words: int = 2000

    # 同步码字符集（去掉易混淆的 IO01）
    sync_code_chars: str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    sync_code_length: int = 6


settings = Settings()
