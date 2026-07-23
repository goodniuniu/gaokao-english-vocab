// ============================================
// 多设备同步冲突合并模块（纯函数，可单测）
// ============================================
// 触发场景：设备 A、B 共用同一同步码，B 先上传，
// A 再上传时服务器返回 409 → 客户端拉取云端数据，
// 用本模块与本地数据按字段合并后再上传。
//
// 合并原则：
//   - 学习进度类（srs/wrong/best/done）：保守取"练得更多"的一侧，不叠加
//     （SRS 记录叠加会破坏 SM-2 的 interval/EF 不变量）
//   - 集合类（custom）：按词取并集
//   - 设置类（settings）：以本地为准
// ============================================

var SyncMerge = (function() {

  // SRS：逐词保留"练习总量更大"的记录；持平取复习时间更新的一侧
  function mergeSRS(local, cloud) {
    var result = {};
    var key, l, c;
    for (key in cloud) result[key] = cloud[key];
    for (key in local) {
      l = local[key];
      c = result[key];
      if (!c) { result[key] = l; continue; }
      var lTotal = l.total || 0, cTotal = c.total || 0;
      if (lTotal > cTotal) { result[key] = l; continue; }
      if (lTotal === cTotal && (l.lastReview || 0) > (c.lastReview || 0)) {
        result[key] = l;
      }
    }
    return result;
  }

  // 错题本：逐词保留错误次数更多的记录（并集）
  function mergeWrong(local, cloud) {
    var result = {};
    var key;
    for (key in cloud) result[key] = cloud[key];
    for (key in local) {
      if (!result[key] || (local[key].wrong || 0) > (result[key].wrong || 0)) {
        result[key] = local[key];
      }
    }
    return result;
  }

  // 历史最佳：逐模式取较大值
  function mergeBest(local, cloud) {
    var result = {};
    var key;
    for (key in cloud) result[key] = cloud[key];
    for (key in local) {
      if (!(key in result) || local[key] > result[key]) {
        result[key] = local[key];
      }
    }
    return result;
  }

  // 累计答题数：取较大值（单调递增计数器，叠加会重复计数）
  function mergeDone(local, cloud) {
    return Math.max(local || 0, cloud || 0);
  }

  // 自定义单词：按小写 word 取并集，冲突时以本地为准
  function mergeCustom(local, cloud) {
    var result = (cloud || []).slice();
    var seen = {};
    result.forEach(function(w) { seen[w.word.toLowerCase()] = true; });
    (local || []).forEach(function(w) {
      var k = w.word.toLowerCase();
      if (!seen[k]) {
        result.push(w);
        seen[k] = true;
      }
    });
    return result;
  }

  // 每日进度：同一天取较大进度；不同天取较新的一天；目标取较大值
  function mergeDaily(local, cloud) {
    local = local || { date: '', count: 0, goal: 20 };
    cloud = cloud || { date: '', count: 0, goal: 20 };
    var base;
    if (local.date === cloud.date) {
      base = {
        date: local.date,
        count: Math.max(local.count || 0, cloud.count || 0),
        goal: Math.max(local.goal || 20, cloud.goal || 20)
      };
    } else {
      base = (local.date || '') > (cloud.date || '') ? local : cloud;
      base = {
        date: base.date,
        count: base.count || 0,
        goal: Math.max(local.goal || 20, cloud.goal || 20)
      };
    }
    return base;
  }

  // 连续天数：best 取较大；current/lastDate 取打卡日期较新的一侧，同日取较大 current
  function mergeStreak(local, cloud) {
    local = local || { current: 0, best: 0, lastDate: '' };
    cloud = cloud || { current: 0, best: 0, lastDate: '' };
    var base;
    if (local.lastDate === cloud.lastDate) {
      base = (local.current || 0) >= (cloud.current || 0) ? local : cloud;
    } else {
      base = (local.lastDate || '') > (cloud.lastDate || '') ? local : cloud;
    }
    return {
      current: base.current || 0,
      best: Math.max(local.best || 0, cloud.best || 0),
      lastDate: base.lastDate || ''
    };
  }

  // 全量合并：localData/cloudData 均为同步 payload 结构
  function mergeAll(localData, cloudData) {
    cloudData = cloudData || {};
    return {
      srs: mergeSRS(localData.srs || {}, cloudData.srs || {}),
      wrong: mergeWrong(localData.wrong || {}, cloudData.wrong || {}),
      best: mergeBest(localData.best || {}, cloudData.best || {}),
      done: mergeDone(localData.done, cloudData.done),
      custom: mergeCustom(localData.custom || [], cloudData.custom || []),
      daily: mergeDaily(localData.daily, cloudData.daily),
      streak: mergeStreak(localData.streak, cloudData.streak),
      settings: localData.settings || cloudData.settings || {} // 设置以本地为准
    };
  }

  return {
    mergeSRS: mergeSRS,
    mergeWrong: mergeWrong,
    mergeBest: mergeBest,
    mergeDone: mergeDone,
    mergeCustom: mergeCustom,
    mergeDaily: mergeDaily,
    mergeStreak: mergeStreak,
    mergeAll: mergeAll
  };
})();

// Node 环境（单元测试）下导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncMerge;
}
