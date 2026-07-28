"""
SQLite 数据访问层 - KV 模型

完美对应 Cloudflare KV 的 key-value 结构：
  - 'code:CODE' → 用户元数据 JSON
  - 'data:CODE' → 用户全部学习数据 JSON
  - 'rl:IP:BUCKET' → 限流计数（带过期时间）

为什么用单表 KV 而不是分表：
  1. 与原 Worker 代码逻辑一一对应（迁移工作量最小）
  2. 复用限流、用户、数据三类 key 的统一过期/清理逻辑
  3. 未来扩展新 key 类型无需改 schema
"""

from __future__ import annotations
import sqlite3
import threading
import time
from typing import Optional, Tuple

from config import settings


# 线程安全的连接池（FastAPI 同步路由跑在线程池中，每线程独立连接）
_thread_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    """获取当前线程的 SQLite 连接（惰性创建）"""
    conn = getattr(_thread_local, "conn", None)
    if conn is None:
        # check_same_thread=False 因为我们跨线程使用（但每个线程一个连接）
        # isolation_level=None 启用 autocommit，简化事务管理
        conn = sqlite3.connect(settings.db_path, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")  # WAL 模式，读写并发更好
        conn.execute("PRAGMA synchronous=NORMAL")  # 性能与安全平衡
        conn.execute("PRAGMA foreign_keys=ON")
        _thread_local.conn = conn
    return conn


def init_db() -> None:
    """初始化数据库（创建表、索引）"""
    conn = _get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS kv_store (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            expires_at INTEGER  -- unix 秒；NULL = 永久
        );

        -- 限流计数清理索引（按过期时间）
        CREATE INDEX IF NOT EXISTS idx_kv_expires
            ON kv_store(expires_at)
            WHERE expires_at IS NOT NULL;
        """
    )


def get(key: str) -> Optional[str]:
    """读取 key；自动忽略已过期项（惰性删除）"""
    conn = _get_conn()
    row = conn.execute(
        "SELECT value, expires_at FROM kv_store WHERE key = ?",
        (key,),
    ).fetchone()
    if row is None:
        return None
    # 过期检查
    if row["expires_at"] is not None and row["expires_at"] <= int(time.time()):
        # 惰性删除（不阻塞读取）
        conn.execute("DELETE FROM kv_store WHERE key = ?", (key,))
        return None
    return row["value"]


def put(key: str, value: str, ttl: Optional[int] = None) -> None:
    """
    写入 key-value
    ttl: None = 永久；正整数 = N 秒后过期
    """
    expires_at = (int(time.time()) + ttl) if ttl and ttl > 0 else None
    conn = _get_conn()
    conn.execute(
        """
        INSERT INTO kv_store (key, value, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            expires_at = excluded.expires_at
        """,
        (key, value, expires_at),
    )


def delete(key: str) -> None:
    """删除 key（不存在时静默）"""
    conn = _get_conn()
    conn.execute("DELETE FROM kv_store WHERE key = ?", (key,))


def increment_with_limit(key: str, limit: int, ttl: int = 180) -> Tuple[bool, int]:
    """
    限流计数：原子地 +1 并判断是否超限

    返回 (是否被限流, 当前计数)。
    - 第一次访问：插入计数=1，设置 TTL
    - 后续访问：+1 并检查
    - 超过 limit 返回 True

    实现：用 SQLite 的原子 UPDATE（WAL 模式下并发安全）
    """
    now = int(time.time())
    conn = _get_conn()

    # 先尝试插入（如果是新 key 或已过期）
    # ON CONFLICT 不更新 expires_at，保持原窗口
    conn.execute(
        """
        INSERT INTO kv_store (key, value, expires_at)
        VALUES (?, '1', ?)
        ON CONFLICT(key) DO UPDATE SET
            value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
        WHERE kv_store.expires_at IS NOT NULL AND kv_store.expires_at > ?
        """,
        (key, now + ttl, now),
    )
    # 如果记录已过期，上面的 UPDATE WHERE 不满足，value 仍是 '1'，需要重置 expires_at
    conn.execute(
        """
        UPDATE kv_store
        SET value = '1', expires_at = ?
        WHERE key = ? AND (expires_at IS NULL OR expires_at <= ?)
        """,
        (now + ttl, key, now),
    )

    row = conn.execute("SELECT value FROM kv_store WHERE key = ?", (key,)).fetchone()
    count = int(row["value"]) if row else 0
    return count > limit, count


def cleanup_expired() -> int:
    """
    主动清理所有过期项（供定时任务调用）
    返回删除的行数
    """
    now = int(time.time())
    conn = _get_conn()
    cur = conn.execute(
        "DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?",
        (now,),
    )
    return cur.rowcount


def list_keys(prefix: str) -> list:
    """列出所有以 prefix 开头的 key（迁移脚本用）"""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT key, value FROM kv_store WHERE key LIKE ? AND "
        "(expires_at IS NULL OR expires_at > ?)",
        (prefix + "%", int(time.time())),
    ).fetchall()
    return [(row["key"], row["value"]) for row in rows]
