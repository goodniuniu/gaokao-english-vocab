// ============================================
// SRS 间隔重复算法单元测试
// 运行：npm test（Node 内置 test runner，零依赖）
// ============================================

const test = require('node:test');
const assert = require('node:assert/strict');
const SRS = require('../js/srs.js');

const DAY_MS = 24 * 60 * 60 * 1000;

function makeBank(words) {
  return words.map(function(w) {
    return { word: w, phonetic: '', pos: 'n.', meaning: w + ' 释义', exampleEn: '', exampleZh: '' };
  });
}

// 构造一条"到期复习"记录（reps>0 且 nextReview 已过）
function makeDueRecord(intervalDays) {
  return {
    word: 'due', level: 2, ef: 2.5,
    interval: intervalDays, reps: 3,
    nextReview: Date.now() - 1000, // 已到期
    lastReview: Date.now() - intervalDays * DAY_MS - 1000,
    correct: 3, total: 3
  };
}

test('updateRecord: 首次答对 → interval=1, level=学习中', () => {
  const data = {};
  const rec = SRS.updateRecord(data, 'Apple', true);
  assert.equal(rec.reps, 1);
  assert.equal(rec.interval, 1);
  assert.equal(rec.correct, 1);
  assert.equal(rec.total, 1);
  assert.equal(rec.level, SRS.LEVELS.LEARNING);
  // key 统一小写
  assert.ok(data['apple']);
});

test('updateRecord: 连续答对间隔按 1 → 3 → ×EF 增长，最终达到已掌握', () => {
  const data = {};
  SRS.updateRecord(data, 'apple', true);
  let rec = SRS.updateRecord(data, 'apple', true);
  assert.equal(rec.interval, 3);
  assert.equal(rec.level, SRS.LEVELS.FAMILIAR);

  rec = SRS.updateRecord(data, 'apple', true);
  assert.equal(rec.interval, Math.round(3 * rec.ef));

  // 继续答对直到满足掌握条件（reps>=5 且 interval>=7）
  rec = SRS.updateRecord(data, 'apple', true);
  rec = SRS.updateRecord(data, 'apple', true);
  assert.ok(rec.reps >= 5);
  assert.ok(rec.interval >= 7);
  assert.equal(rec.level, SRS.LEVELS.MASTERED);
});

test('updateRecord: 答错重置连续答对与间隔，EF 下降但不低于 1.3', () => {
  const data = {};
  SRS.updateRecord(data, 'apple', true);
  SRS.updateRecord(data, 'apple', true);
  const before = SRS.getRecord(data, 'apple');
  const efBefore = before.ef;
  const levelBefore = before.level;

  const rec = SRS.updateRecord(data, 'apple', false);
  assert.equal(rec.reps, 0);
  assert.equal(rec.interval, 0);
  assert.equal(rec.ef, Math.max(1.3, efBefore - 0.25));
  assert.equal(rec.level, levelBefore - 1);
  // 历史统计保留
  assert.equal(rec.correct, 2);
  assert.equal(rec.total, 3);
  // interval=0 → 立即可复习
  assert.equal(rec.nextReview, rec.lastReview);
});

test('updateRecord: EF 上限 3.0，多次答错下限 1.3', () => {
  const data = {};
  for (let i = 0; i < 20; i++) SRS.updateRecord(data, 'apple', true);
  assert.ok(SRS.getRecord(data, 'apple').ef <= 3.0);

  const data2 = {};
  SRS.updateRecord(data2, 'apple', true); // 建立记录
  for (let i = 0; i < 20; i++) SRS.updateRecord(data2, 'apple', false);
  assert.equal(SRS.getRecord(data2, 'apple').ef, 1.3);
});

test('getDueWords: 只返回已学且到期的词', () => {
  const data = {
    due: makeDueRecord(3),
    future: {
      word: 'future', level: 1, ef: 2.5, interval: 1, reps: 1,
      nextReview: Date.now() + DAY_MS, // 未到期
      lastReview: Date.now(), correct: 1, total: 1
    },
    fresh: SRS.getRecord({}, 'fresh') // reps=0 的新记录不算复习
  };
  const due = SRS.getDueWords(data);
  assert.deepEqual(due, ['due']);
});

test('getNewWords: 排除已学词并遵守数量上限', () => {
  const bank = makeBank(['a', 'b', 'c', 'd', 'e']);
  const data = {};
  SRS.updateRecord(data, 'b', true);
  SRS.updateRecord(data, 'd', false);

  assert.deepEqual(SRS.getNewWords(data, bank, 999), ['a', 'c', 'e']);
  assert.deepEqual(SRS.getNewWords(data, bank, 2), ['a', 'c']);
});

test('generateSession: 40% 复习词 + 60% 新词，无重复，数量达标', () => {
  const bank = makeBank(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']);
  const data = { d1: makeDueRecord(1), d2: makeDueRecord(2), d3: makeDueRecord(3), d4: makeDueRecord(4) };
  data.d1.word = 'd1'; data.d2.word = 'd2'; data.d3.word = 'd3'; data.d4.word = 'd4';

  const session = SRS.generateSession(data, bank, 10);
  assert.equal(session.length, 10);
  assert.equal(new Set(session).size, 10, '不应有重复');

  const dueCount = session.filter(w => ['d1', 'd2', 'd3', 'd4'].includes(w)).length;
  assert.equal(dueCount, 4, '复习词应占 40%');
});

test('generateSession: 复习词不足时用新词补齐', () => {
  const bank = makeBank(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10']);
  const data = { d1: makeDueRecord(1) };
  data.d1.word = 'd1';

  const session = SRS.generateSession(data, bank, 10);
  assert.equal(session.length, 10);
  assert.ok(session.includes('d1'));
});

test('getStats: 按掌握等级正确计数', () => {
  const data = {
    a: { level: 0 }, b: { level: 1 }, c: { level: 1 },
    d: { level: 2 }, e: { level: 3 }
  };
  const stats = SRS.getStats(data);
  assert.deepEqual(stats, { new: 1, learning: 2, familiar: 1, mastered: 1, total: 5 });
});

test('shuffle: 不修改原数组，元素保持一致', () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const copy = src.slice();
  const out = SRS.shuffle(src);
  assert.deepEqual(src, copy, '原数组不应被修改');
  assert.deepEqual(out.slice().sort((a, b) => a - b), copy, '元素集合应一致');
});
