"""
多设备同步冲突合并模块（从 js/merge.js 一比一翻译）

触发场景：设备 A、B 共用同一同步码，B 先上传，
A 再上传时服务器返回 409 → 客户端拉取云端数据，
用本模块与本地数据按字段合并后再上传。

合并原则：
  - 学习进度类（srs/wrong/best/done）：保守取"练得更多"的一侧，不叠加
    （SRS 记录叠加会破坏 SM-2 的 interval/EF 不变量）
  - 集合类（custom）：按词取并集
  - 设置类（settings）：以本地为准
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional


# SRS：逐词保留"练习总量更大"的记录；持平取复习时间更新的一侧
def merge_srs(local: Dict[str, Any], cloud: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = dict(cloud)
    for key, l in local.items():
        c = result.get(key)
        if c is None:
            result[key] = l
            continue
        l_total = l.get("total", 0) or 0
        c_total = c.get("total", 0) or 0
        if l_total > c_total:
            result[key] = l
            continue
        if l_total == c_total and (l.get("lastReview", 0) or 0) > (c.get("lastReview", 0) or 0):
            result[key] = l
    return result


# 错题本：逐词保留错误次数更多的记录（并集）
def merge_wrong(local: Dict[str, Any], cloud: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = dict(cloud)
    for key, val in local.items():
        existing = result.get(key)
        if existing is None or (val.get("wrong", 0) or 0) > (existing.get("wrong", 0) or 0):
            result[key] = val
    return result


# 历史最佳：逐模式取较大值
def merge_best(local: Dict[str, Any], cloud: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = dict(cloud)
    for key, val in local.items():
        if key not in result or (val or 0) > (result[key] or 0):
            result[key] = val
    return result


# 累计答题数：取较大值（单调递增计数器，叠加会重复计数）
def merge_done(local: Optional[int], cloud: Optional[int]) -> int:
    return max(local or 0, cloud or 0)


# 自定义单词：按小写 word 取并集，冲突时以本地为准
def merge_custom(local: List[Dict[str, Any]], cloud: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = list(cloud or [])
    seen = {w.get("word", "").lower() for w in result if w.get("word")}
    for w in local or []:
        word = w.get("word", "")
        if not word:
            continue
        k = word.lower()
        if k not in seen:
            result.append(w)
            seen.add(k)
    return result


# 每日进度：同一天取较大进度；不同天取较新的一天；目标取较大值
def merge_daily(local: Optional[Dict[str, Any]], cloud: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    local = local or {"date": "", "count": 0, "goal": 20}
    cloud = cloud or {"date": "", "count": 0, "goal": 20}

    if local.get("date") == cloud.get("date"):
        return {
            "date": local.get("date", ""),
            "count": max(local.get("count", 0) or 0, cloud.get("count", 0) or 0),
            "goal": max(local.get("goal", 20) or 20, cloud.get("goal", 20) or 20),
        }
    # 不同天：取日期较新的一侧，goal 仍取较大值
    base = local if (local.get("date", "") or "") > (cloud.get("date", "") or "") else cloud
    return {
        "date": base.get("date", ""),
        "count": base.get("count", 0) or 0,
        "goal": max(local.get("goal", 20) or 20, cloud.get("goal", 20) or 20),
    }


# 连续天数：best 取较大；current/lastDate 取打卡日期较新的一侧，同日取较大 current
def merge_streak(local: Optional[Dict[str, Any]], cloud: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    local = local or {"current": 0, "best": 0, "lastDate": ""}
    cloud = cloud or {"current": 0, "best": 0, "lastDate": ""}

    if local.get("lastDate") == cloud.get("lastDate"):
        base = local if (local.get("current", 0) or 0) >= (cloud.get("current", 0) or 0) else cloud
    else:
        base = local if (local.get("lastDate", "") or "") > (cloud.get("lastDate", "") or "") else cloud

    return {
        "current": base.get("current", 0) or 0,
        "best": max(local.get("best", 0) or 0, cloud.get("best", 0) or 0),
        "lastDate": base.get("lastDate", "") or "",
    }


# 全量合并：local_data/cloud_data 均为同步 payload 结构
def merge_all(local_data: Dict[str, Any], cloud_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cloud_data = cloud_data or {}
    return {
        "srs": merge_srs(local_data.get("srs") or {}, cloud_data.get("srs") or {}),
        "wrong": merge_wrong(local_data.get("wrong") or {}, cloud_data.get("wrong") or {}),
        "best": merge_best(local_data.get("best") or {}, cloud_data.get("best") or {}),
        "done": merge_done(local_data.get("done"), cloud_data.get("done")),
        "custom": merge_custom(local_data.get("custom") or [], cloud_data.get("custom") or []),
        "daily": merge_daily(local_data.get("daily"), cloud_data.get("daily")),
        "streak": merge_streak(local_data.get("streak"), cloud_data.get("streak")),
        # 设置以本地为准（与 JS 版一致）
        "settings": local_data.get("settings") or cloud_data.get("settings") or {},
    }
