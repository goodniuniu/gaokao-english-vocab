"""
merge.py 与 js/merge.js 行为一致性验证

测试用例一比一翻译自 test/merge.test.js（11 个 test）。
运行：python test_merge.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import merge
from merge import (
    merge_srs, merge_wrong, merge_best, merge_done,
    merge_custom, merge_daily, merge_streak, merge_all,
)

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}  {detail}")


def test_merge_srs_picks_larger_total():
    """mergeSRS: 保留练习总量更大的一侧"""
    local = {"apple": {"word": "apple", "total": 10, "correct": 8, "lastReview": 100}}
    cloud = {"apple": {"word": "apple", "total": 5, "correct": 5, "lastReview": 200}}
    check("local total=10 vs cloud total=5 → 10",
          merge_srs(local, cloud)["apple"]["total"] == 10)
    check("cloud total=5 vs local total=10 → 10（顺序无关）",
          merge_srs(cloud, local)["apple"]["total"] == 10)


def test_merge_srs_tie_uses_last_review():
    """mergeSRS: total 持平取 lastReview 更新的一侧；并集保留单侧独有词"""
    local = {
        "apple": {"word": "apple", "total": 5, "lastReview": 300},
        "banana": {"word": "banana", "total": 2, "lastReview": 100},
    }
    cloud = {
        "apple": {"word": "apple", "total": 5, "lastReview": 100},
        "cherry": {"word": "cherry", "total": 7, "lastReview": 50},
    }
    out = merge_srs(local, cloud)
    check("total 持平取 lastReview=300",
          out["apple"]["lastReview"] == 300,
          f"actual: {out['apple']['lastReview']}")
    check("本地独有词 banana 保留", "banana" in out)
    check("云端独有词 cherry 保留", "cherry" in out)


def test_merge_wrong_union():
    """mergeWrong: 并集，逐词保留错误次数更多的记录"""
    local = {"apple": {"word": "apple", "wrong": 3}, "banana": {"word": "banana", "wrong": 1}}
    cloud = {"apple": {"word": "apple", "wrong": 1}, "cherry": {"word": "cherry", "wrong": 2}}
    out = merge_wrong(local, cloud)
    check("apple.wrong=3（保留次数多）", out["apple"]["wrong"] == 3)
    check("banana.wrong=1（本地独有）", out["banana"]["wrong"] == 1)
    check("cherry.wrong=2（云端独有）", out["cherry"]["wrong"] == 2)


def test_merge_best_max():
    """mergeBest: 逐模式取较大值"""
    out = merge_best({"smart": 80, "spell": 100}, {"smart": 90, "review": 70})
    expected = {"smart": 90, "spell": 100, "review": 70}
    check("逐模式取较大值", out == expected, f"actual: {out}")


def test_merge_done_max():
    """mergeDone: 取较大值"""
    check("max(100, 80) = 100", merge_done(100, 80) == 100)
    check("max(0, 80) = 80", merge_done(0, 80) == 80)
    check("max(None, 50) = 50", merge_done(None, 50) == 50)


def test_merge_custom_union():
    """mergeCustom: 按小写 word 取并集，不重复"""
    local = [{"word": "Apple", "meaning": "苹果"}, {"word": "MyWord", "meaning": "我的词"}]
    cloud = [{"word": "apple", "meaning": "苹果(云端)"}, {"word": "CloudWord", "meaning": "云词"}]
    out = merge_custom(local, cloud)
    check("并集长度 = 3", len(out) == 3, f"actual: {len(out)}")
    words = sorted(w["word"].lower() for w in out)
    check("去重后 = [apple, cloudword, myword]",
          words == ["apple", "cloudword", "myword"], f"actual: {words}")


def test_merge_daily_same_day():
    """mergeDaily: 同一天 count 取大，goal 取大"""
    out = merge_daily(
        {"date": "Mon Jul 20 2026", "count": 30, "goal": 20},
        {"date": "Mon Jul 20 2026", "count": 15, "goal": 50},
    )
    expected = {"date": "Mon Jul 20 2026", "count": 30, "goal": 50}
    check("count=30, goal=50", out == expected, f"actual: {out}")


def test_merge_daily_different_day():
    """mergeDaily: 不同天取较新的一天"""
    out = merge_daily(
        {"date": "Tue Jul 21 2026", "count": 5, "goal": 20},
        {"date": "Mon Jul 20 2026", "count": 50, "goal": 20},
    )
    check("date = Tue Jul 21 2026（较新）", out["date"] == "Tue Jul 21 2026")
    check("count = 5（新的一侧）", out["count"] == 5)


def test_merge_streak_best_and_last_date():
    """mergeStreak: best 取大，lastDate 取新，同日 current 取大"""
    out = merge_streak(
        {"current": 3, "best": 10, "lastDate": "Tue Jul 21 2026"},
        {"current": 8, "best": 7, "lastDate": "Mon Jul 20 2026"},
    )
    expected = {"current": 3, "best": 10, "lastDate": "Tue Jul 21 2026"}
    check("不同日：current=3, best=10, lastDate=Tue",
          out == expected, f"actual: {out}")

    same_day = merge_streak(
        {"current": 3, "best": 3, "lastDate": "Tue Jul 21 2026"},
        {"current": 5, "best": 5, "lastDate": "Tue Jul 21 2026"},
    )
    check("同日：current 取大 = 5", same_day["current"] == 5)


def test_merge_all_complete():
    """mergeAll: 整包合并，settings 以本地为准"""
    local = {
        "srs": {"apple": {"total": 10, "lastReview": 100}},
        "wrong": {"apple": {"wrong": 2}},
        "best": {"smart": 80},
        "done": 100,
        "custom": [{"word": "Mine", "meaning": "我的"}],
        "daily": {"date": "Tue", "count": 10, "goal": 20},
        "streak": {"current": 3, "best": 3, "lastDate": "Tue"},
        "settings": {"autoSpeak": True},
    }
    cloud = {
        "srs": {"banana": {"total": 5, "lastReview": 200}},
        "wrong": {"cherry": {"wrong": 1}},
        "best": {"smart": 90},
        "done": 150,
        "custom": [{"word": "Cloud", "meaning": "云的"}],
        "daily": {"date": "Tue", "count": 20, "goal": 20},
        "streak": {"current": 1, "best": 9, "lastDate": "Mon"},
        "settings": {"autoSpeak": False},
    }
    out = merge_all(local, cloud)
    check("srs 并集", sorted(out["srs"].keys()) == ["apple", "banana"])
    check("wrong 并集", sorted(out["wrong"].keys()) == ["apple", "cherry"])
    check("best.smart = 90（取大）", out["best"]["smart"] == 90)
    check("done = 150（取大）", out["done"] == 150)
    check("custom 并集长度 = 2", len(out["custom"]) == 2)
    check("daily.count = 20（同日取大）", out["daily"]["count"] == 20)
    check("streak.best = 9（取大）", out["streak"]["best"] == 9)
    check("settings.autoSpeak = True（以本地为准）",
          out["settings"]["autoSpeak"] is True,
          f"actual: {out['settings']}")


def test_merge_all_cloud_none():
    """mergeAll: 云端为空时等于本地"""
    local = {
        "srs": {"a": {"total": 1}},
        "wrong": {},
        "best": {},
        "done": 5,
        "custom": [],
        "daily": {"date": "Tue", "count": 1, "goal": 20},
        "streak": {"current": 1, "best": 1, "lastDate": "Tue"},
        "settings": {},
    }
    out = merge_all(local, None)
    check("云端 None：done = 5", out["done"] == 5)
    check("云端 None：srs.a 保留", "a" in out["srs"])


if __name__ == "__main__":
    print("=" * 60)
    print("merge.py 与 js/merge.js 行为一致性测试")
    print("=" * 60)

    tests = [
        ("mergeSRS 保留练习总量更大的一侧", test_merge_srs_picks_larger_total),
        ("mergeSRS total 持平取 lastReview 更新的一侧", test_merge_srs_tie_uses_last_review),
        ("mergeWrong 并集", test_merge_wrong_union),
        ("mergeBest 逐模式取较大值", test_merge_best_max),
        ("mergeDone 取较大值", test_merge_done_max),
        ("mergeCustom 按小写 word 取并集", test_merge_custom_union),
        ("mergeDaily 同一天取大", test_merge_daily_same_day),
        ("mergeDaily 不同天取较新", test_merge_daily_different_day),
        ("mergeStreak best/lastDate/current", test_merge_streak_best_and_last_date),
        ("mergeAll 整包合并 settings 以本地为准", test_merge_all_complete),
        ("mergeAll 云端为空时等于本地", test_merge_all_cloud_none),
    ]

    for name, fn in tests:
        print(f"\n[测试] {name}")
        fn()

    print("\n" + "=" * 60)
    print(f"结果：{PASS} 通过 / {FAIL} 失败 / 共 {PASS + FAIL} 项")
    print("=" * 60)

    sys.exit(0 if FAIL == 0 else 1)
