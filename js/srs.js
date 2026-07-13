// ============================================
// SRS 间隔重复算法 (简化版 SM-2)
// ============================================

var SRS = (function() {

  // 掌握等级
  // 0: 新词（未学过）
  // 1: 学习中（刚接触）
  // 2: 熟悉中
  // 3: 已掌握
  var LEVELS = {
    NEW: 0,
    LEARNING: 1,
    FAMILIAR: 2,
    MASTERED: 3
  };

  // SM-2 核心参数
  // 每个单词的 SRS 记录格式：
  // {
  //   word: "apple",
  //   level: 0,           // 当前掌握等级
  //   ef: 2.5,            // 难度系数 easiness factor (1.3 ~ 3.0)
  //   interval: 0,        // 下次复习间隔（天）
  //   reps: 0,            // 连续答对次数
  //   nextReview: 0,      // 下次复习时间戳
  //   lastReview: 0,      // 上次复习时间戳
  //   correct: 0,         // 总答对次数
  //   total: 0            // 总答题次数
  // }

  var DAY_MS = 24 * 60 * 60 * 1000;

  function nowTs() { return Date.now(); }

  // 获取或创建一个词的 SRS 记录
  function getRecord(srsData, word) {
    var key = word.toLowerCase();
    if (!srsData[key]) {
      srsData[key] = {
        word: key,
        level: LEVELS.NEW,
        ef: 2.5,
        interval: 0,
        reps: 0,
        nextReview: 0,
        lastReview: 0,
        correct: 0,
        total: 0
      };
    }
    return srsData[key];
  }

  // 答题后更新 SRS 记录
  // quality: 0=答错, 1=答对
  function updateRecord(srsData, word, isCorrect) {
    var rec = getRecord(srsData, word);
    rec.total++;
    rec.lastReview = nowTs();

    if (isCorrect) {
      rec.correct++;
      rec.reps++;

      // SM-2 算法核心
      if (rec.reps === 1) {
        rec.interval = 1;
      } else if (rec.reps === 2) {
        rec.interval = 3;
      } else {
        rec.interval = Math.round(rec.interval * rec.ef);
      }

      // 更新难度系数
      rec.ef = rec.ef + (0.1 - (1 - 1) * (0.08 + (1 - 1) * 0.02));
      if (rec.ef < 1.3) rec.ef = 1.3;
      if (rec.ef > 3.0) rec.ef = 3.0;

      // 升级
      if (rec.reps >= 5 && rec.interval >= 7) {
        rec.level = LEVELS.MASTERED;
      } else if (rec.reps >= 2) {
        rec.level = LEVELS.FAMILIAR;
      } else {
        rec.level = LEVELS.LEARNING;
      }
    } else {
      // 答错：重置
      rec.reps = 0;
      rec.interval = 0;
      rec.ef = Math.max(1.3, rec.ef - 0.2);
      if (rec.level > LEVELS.NEW) rec.level--;
    }

    rec.nextReview = rec.lastReview + rec.interval * DAY_MS;
    return rec;
  }

  // 获取今天需要复习的单词
  function getDueWords(srsData) {
    var now = nowTs();
    var due = [];
    for (var key in srsData) {
      var rec = srsData[key];
      if (rec.nextReview <= now && rec.reps > 0) {
        due.push(key);
      }
    }
    return due;
  }

  // 获取新词（未学过的）
  function getNewWords(srsData, bank, count) {
    var learned = {};
    for (var key in srsData) {
      learned[key] = true;
    }
    var newWords = [];
    for (var i = 0; i < bank.length && newWords.length < count; i++) {
      var w = bank[i].word.toLowerCase();
      if (!learned[w]) {
        newWords.push(w);
      }
    }
    return newWords;
  }

  // 混合生成一组练习：既含新词也含复习词
  function generateSession(srsData, bank, total) {
    var dueWords = getDueWords(srsData);
    // 复习词占 40%，新词占 60%（不足时互相补）
    var reviewCount = Math.min(Math.ceil(total * 0.4), dueWords.length);
    var newCount = total - reviewCount;

    var session = [];

    // 随机选复习词
    var shuffledDue = shuffle(dueWords);
    for (var i = 0; i < reviewCount; i++) {
      session.push(shuffledDue[i]);
    }

    // 随机选新词
    var newWords = getNewWords(srsData, bank, newCount);
    for (var i = 0; i < newWords.length; i++) {
      session.push(newWords[i]);
    }

    // 如果总数不够，从已学过的随机补
    if (session.length < total) {
      var allLearned = Object.keys(srsData);
      var shuffledAll = shuffle(allLearned);
      for (var i = 0; i < shuffledAll.length && session.length < total; i++) {
        if (session.indexOf(shuffledAll[i]) === -1) {
          session.push(shuffledAll[i]);
        }
      }
    }

    return shuffle(session).slice(0, total);
  }

  // 统计掌握度
  function getStats(srsData) {
    var stats = { new: 0, learning: 0, familiar: 0, mastered: 0, total: 0 };
    for (var key in srsData) {
      stats.total++;
      switch(srsData[key].level) {
        case LEVELS.NEW: stats.new++; break;
        case LEVELS.LEARNING: stats.learning++; break;
        case LEVELS.FAMILIAR: stats.familiar++; break;
        case LEVELS.MASTERED: stats.mastered++; break;
      }
    }
    return stats;
  }

  // 工具
  function shuffle(arr) {
    arr = arr.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  return {
    LEVELS: LEVELS,
    getRecord: getRecord,
    updateRecord: updateRecord,
    getDueWords: getDueWords,
    getNewWords: getNewWords,
    generateSession: generateSession,
    getStats: getStats
  };
})();
