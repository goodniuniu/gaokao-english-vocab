#!/usr/bin/env python3
"""
从 Cloudflare Worker KV 迁移数据到本地 SQLite

使用 Cloudflare REST API 拉取 KV 数据，写入 server/db.py 使用的 SQLite 表。

前置条件：
  1. 安装依赖：pip install httpx
  2. 准备以下信息（在 Cloudflare 控制台获取）：
     - Account ID：Workers 页面右侧
     - API Token：新建一个 token，权限选「Workers KV Storage: Read」
     - KV Namespace ID：在 wrangler.toml 的 kv_namespaces.id 字段
       （当前是 e83869e52a5f4283887859d76eba1f73）

用法：
  CLOUDFLARE_ACCOUNT_ID=xxx \
  CLOUDFLARE_API_TOKEN=xxx \
  CLOUDFLARE_KV_NAMESPACE_ID=e83869e52a5f4283887859d76eba1f73 \
  VOCAB_DB_PATH=./vocab.db \
  python migrate_from_cf.py

注意：
  - 迁移过程是幂等的（重复执行不会出错，会覆盖）
  - 默认 dry-run 只列出 key 数量，加 --apply 才真正写入
  - 限流键（rl: 前缀）不迁移（过期数据，无意义）
"""

from __future__ import annotations
import argparse
import json
import os
import sys
import time
from typing import Iterator

import httpx

# 导入本地 db 模块（同目录）
import db
from config import settings


CF_API_BASE = "https://api.cloudflare.com/client/v4"


def _env_or_die(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        print(f"错误：环境变量 {name} 未设置", file=sys.stderr)
        print(
            "请设置：\n"
            f"  export {name}=...\n"
            "详细信息见脚本顶部文档。",
            file=sys.stderr,
        )
        sys.exit(1)
    return v


def list_kv_keys(
    client: httpx.Client,
    account_id: str,
    namespace_id: str,
    api_token: str,
) -> Iterator[str]:
    """分页拉取所有 key 名（Cloudflare 一次最多 1000 条）"""
    url = f"{CF_API_BASE}/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/keys"
    cursor = None
    while True:
        params = {"limit": 1000}
        if cursor:
            params["cursor"] = cursor
        resp = client.get(url, headers={"Authorization": f"Bearer {api_token}"}, params=params)
        resp.raise_for_status()
        body = resp.json()
        if not body.get("success"):
            raise RuntimeError(f"Cloudflare API 返回错误: {body.get('errors')}")
        data = body["result"]
        for item in data:
            yield item["name"]
        # 翻页
        cursor_info = body.get("result_info", {})
        cursor = cursor_info.get("cursor")
        if not cursor_info.get("count"):
            break
        # 避免 API 限速
        time.sleep(0.3)


def get_kv_value(
    client: httpx.Client,
    account_id: str,
    namespace_id: str,
    api_token: str,
    key: str,
) -> str:
    """读取单个 key 的原始值（字符串）"""
    url = (
        f"{CF_API_BASE}/accounts/{account_id}/storage/kv/namespaces/{namespace_id}"
        f"/values/{key}"
    )
    resp = client.get(url, headers={"Authorization": f"Bearer {api_token}"})
    resp.raise_for_status()
    return resp.text


def main():
    parser = argparse.ArgumentParser(description="从 Cloudflare KV 迁移到本地 SQLite")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="真正写入数据库（默认 dry-run 只预览）",
    )
    args = parser.parse_args()

    account_id = _env_or_die("CLOUDFLARE_ACCOUNT_ID")
    api_token = _env_or_die("CLOUDFLARE_API_TOKEN")
    namespace_id = os.environ.get(
        "CLOUDFLARE_KV_NAMESPACE_ID",
        "e83869e52a5f4283887859d76eba1f73",  # 当前项目的 KV namespace
    )

    print(f"[准备] SQLite 路径: {settings.db_path}")
    print(f"[准备] CF Account: {account_id[:8]}...")
    print(f"[准备] CF KV Namespace: {namespace_id}")
    print(f"[模式] {'实际写入' if args.apply else 'DRY-RUN（只预览）'}")
    print()

    # 初始化 DB（确保表存在）
    db.init_db()

    with httpx.Client(timeout=30) as client:
        print("[1/3] 拉取 KV key 列表...")
        keys = list(list_kv_keys(client, account_id, namespace_id, api_token))
        print(f"      共 {len(keys)} 个 key")

        # 分类统计
        skipped_rate_limit = [k for k in keys if k.startswith("rl:")]
        code_keys = [k for k in keys if k.startswith("code:")]
        data_keys = [k for k in keys if k.startswith("data:")]
        other_keys = [
            k for k in keys if not (k.startswith(("rl:", "code:", "data:")))
        ]
        print(f"      - code:* (用户元数据): {len(code_keys)} 个")
        print(f"      - data:* (学习数据) : {len(data_keys)} 个")
        print(f"      - rl:*   (限流计数) : {len(skipped_rate_limit)} 个 [跳过，无意义]")
        if other_keys:
            print(f"      - 其他            : {len(other_keys)} 个")
            for k in other_keys[:10]:
                print(f"          {k}")

        # 跳过限流键
        keys_to_migrate = [k for k in keys if not k.startswith("rl:")]
        print(f"\n[2/3] 将迁移 {len(keys_to_migrate)} 个 key")

        if not args.apply:
            print("\n[完成] DRY-RUN。加 --apply 实际写入。")
            for k in keys_to_migrate[:5]:
                print(f"  示例：{k}")
            return

        print("\n[3/3] 开始迁移...")
        success = 0
        failed = 0
        for i, key in enumerate(keys_to_migrate, 1):
            try:
                value = get_kv_value(client, account_id, namespace_id, api_token, key)
                # 校验是合法 JSON（KV 中都是 JSON 字符串）
                try:
                    json.loads(value)
                except json.JSONDecodeError:
                    print(f"  [{i}/{len(keys_to_migrate)}] {key} 跳过（非 JSON）")
                    failed += 1
                    continue

                db.put(key, value)
                success += 1
                if i % 10 == 0 or i == len(keys_to_migrate):
                    print(f"  [{i}/{len(keys_to_migrate)}] 已写入")
                # 防 API 限速
                time.sleep(0.15)
            except Exception as e:
                print(f"  [{i}/{len(keys_to_migrate)}] {key} 失败: {e}", file=sys.stderr)
                failed += 1

        print(f"\n[完成] 成功 {success}，失败 {failed}")
        print(f"       数据库: {settings.db_path}")
        print("\n下一步：在服务器上启动 FastAPI，前端切换 API_BASE。")


if __name__ == "__main__":
    main()
