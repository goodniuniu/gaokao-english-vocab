"""
Pydantic 数据模型 - 请求体自动校验

对应原 Worker validateSyncBody 的逻辑：
  - body 必须是 JSON 对象
  - srs/wrong/best/daily/streak/settings 必须是对象（不是数组）
  - done 必须是数字
  - baseSync 必须是数字
  - custom 必须是数组，且有大小和字段格式限制

Pydantic 比 JS 手写校验更强大：
  - 自动返回 422 + 详细错误（FastAPI 内置）
  - 类型转换更宽容（字符串数字 → 数字）
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


# 注册请求
class RegisterRequest(BaseModel):
    name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def truncate_name(cls, v: Optional[str]) -> str:
        if v is None or not v.strip():
            return "学生"
        # 与原 Worker 一致：截断到 20 字符
        return v.strip()[:20]


# 自定义单词条目
class CustomWord(BaseModel):
    word: str = Field(..., max_length=100)
    meaning: str = Field(..., max_length=500)
    # 允许额外字段（与原数据格式兼容）
    model_config = {"extra": "allow"}


# 同步上传请求（对应 /api/sync/:code 的 body）
class SyncPayload(BaseModel):
    srs: Optional[Dict[str, Any]] = None
    wrong: Optional[Dict[str, Any]] = None
    best: Optional[Dict[str, Any]] = None
    daily: Optional[Dict[str, Any]] = None
    streak: Optional[Dict[str, Any]] = None
    settings: Optional[Dict[str, Any]] = None
    done: Optional[int] = None
    baseSync: Optional[int] = None
    custom: Optional[List[Dict[str, Any]]] = None

    @field_validator("srs", "wrong", "best", "daily", "streak", "settings")
    @classmethod
    def must_be_object(cls, v):
        # 不允许是数组（数组会被 dict 接收但其实是 list）
        if v is not None and not isinstance(v, dict):
            raise ValueError("必须是对象，不能是数组")
        return v

    @field_validator("custom")
    @classmethod
    def check_custom(cls, v):
        from config import settings as app_settings

        if v is None:
            return None
        if len(v) > app_settings.max_custom_words:
            raise ValueError(
                f"custom 超过 {app_settings.max_custom_words} 条上限"
            )
        for w in v:
            if not isinstance(w, dict):
                raise ValueError("custom 条目必须是对象")
            word = w.get("word")
            meaning = w.get("meaning")
            if not isinstance(word, str) or not isinstance(meaning, str):
                raise ValueError("custom 条目缺少 word/meaning 字段")
            if len(word) > 100 or len(meaning) > 500:
                raise ValueError("custom 条目字段超长")
        return v
