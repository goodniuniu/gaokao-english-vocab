// ============================================
// 多设备同步冲突合并单元测试
// 运行：npm test（Node 内置 test runner，零依赖）
// ============================================

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/merge.js');

test('mergeSRS: 保留练习总量更大的一侧', () => {
  const local = { apple: { word: 'apple', total: 10, correct: 8, lastReview: 100 } };
  const cloud = { apple: { word: 'apple', total: 5, correct: 5, lastReview: 200 } };
  assert.equal(M.mergeSRS(local, cloud).apple.total, 10);
  assert.equal(M.mergeSRS(cloud, local).apple.total, 10);
});

test('mergeSRS: total 持平取 lastReview 更新的一侧；并集保留单侧独有词', () => {
  const local = {
    apple: { word: 'apple', total: 5, lastReview: 300 },
    banana: { word: 'banana', total: 2, lastReview: 100 }
  };
  const cloud = {
    apple: { word: 'apple', total: 5, lastReview: 100 },
    cherry: { word: 'cherry', total: 7, lastReview: 50 }
  };
  const out = M.mergeSRS(local, cloud);
  assert.equal(out.apple.lastReview, 300);
  assert.ok(out.banana, '本地独有词保留');
  assert.ok(out.cherry, '云端独有词保留');
});

test('mergeWrong: 并集，逐词保留错误次数更多的记录', () => {
  const local = { apple: { word: 'apple', wrong: 3 }, banana: { word: 'banana', wrong: 1 } };
  const cloud = { apple: { word: 'apple', wrong: 1 }, cherry: { word: 'cherry', wrong: 2 } };
  const out = M.mergeWrong(local, cloud);
  assert.equal(out.apple.wrong, 3);
  assert.equal(out.banana.wrong, 1);
  assert.equal(out.cherry.wrong, 2);
});

test('mergeBest: 逐模式取较大值', () => {
  const out = M.mergeBest({ smart: 80, spell: 100 }, { smart: 90, review: 70 });
  assert.deepEqual(out, { smart: 90, spell: 100, review: 70 });
});

test('mergeDone: 取较大值', () => {
  assert.equal(M.mergeDone(100, 80), 100);
  assert.equal(M.mergeDone(0, 80), 80);
  assert.equal(M.mergeDone(undefined, 50), 50);
});

test('mergeCustom: 按小写 word 取并集，不重复', () => {
  const local = [{ word: 'Apple', meaning: '苹果' }, { word: 'MyWord', meaning: '我的词' }];
  const cloud = [{ word: 'apple', meaning: '苹果(云端)' }, { word: 'CloudWord', meaning: '云词' }];
  const out = M.mergeCustom(local, cloud);
  assert.equal(out.length, 3);
  const words = out.map(w => w.word.toLowerCase()).sort();
  assert.deepEqual(words, ['apple', 'cloudword', 'myword']);
});

test('mergeDaily: 同一天 count 取大，goal 取大', () => {
  const out = M.mergeDaily(
    { date: 'Mon Jul 20 2026', count: 30, goal: 20 },
    { date: 'Mon Jul 20 2026', count: 15, goal: 50 }
  );
  assert.deepEqual(out, { date: 'Mon Jul 20 2026', count: 30, goal: 50 });
});

test('mergeDaily: 不同天取较新的一天', () => {
  const out = M.mergeDaily(
    { date: 'Tue Jul 21 2026', count: 5, goal: 20 },
    { date: 'Mon Jul 20 2026', count: 50, goal: 20 }
  );
  assert.equal(out.date, 'Tue Jul 21 2026');
  assert.equal(out.count, 5);
});

test('mergeStreak: best 取大，lastDate 取新，同日 current 取大', () => {
  const out = M.mergeStreak(
    { current: 3, best: 10, lastDate: 'Tue Jul 21 2026' },
    { current: 8, best: 7, lastDate: 'Mon Jul 20 2026' }
  );
  assert.deepEqual(out, { current: 3, best: 10, lastDate: 'Tue Jul 21 2026' });

  const sameDay = M.mergeStreak(
    { current: 3, best: 3, lastDate: 'Tue Jul 21 2026' },
    { current: 5, best: 5, lastDate: 'Tue Jul 21 2026' }
  );
  assert.equal(sameDay.current, 5);
});

test('mergeAll: 整包合并，settings 以本地为准', () => {
  const local = {
    srs: { apple: { total: 10, lastReview: 100 } },
    wrong: { apple: { wrong: 2 } },
    best: { smart: 80 },
    done: 100,
    custom: [{ word: 'Mine', meaning: '我的' }],
    daily: { date: 'Tue', count: 10, goal: 20 },
    streak: { current: 3, best: 3, lastDate: 'Tue' },
    settings: { autoSpeak: true }
  };
  const cloud = {
    srs: { banana: { total: 5, lastReview: 200 } },
    wrong: { cherry: { wrong: 1 } },
    best: { smart: 90 },
    done: 150,
    custom: [{ word: 'Cloud', meaning: '云的' }],
    daily: { date: 'Tue', count: 20, goal: 20 },
    streak: { current: 1, best: 9, lastDate: 'Mon' },
    settings: { autoSpeak: false }
  };
  const out = M.mergeAll(local, cloud);
  assert.deepEqual(Object.keys(out.srs).sort(), ['apple', 'banana']);
  assert.deepEqual(Object.keys(out.wrong).sort(), ['apple', 'cherry']);
  assert.equal(out.best.smart, 90);
  assert.equal(out.done, 150);
  assert.equal(out.custom.length, 2);
  assert.equal(out.daily.count, 20);
  assert.equal(out.streak.best, 9);
  assert.equal(out.settings.autoSpeak, true, '设置以本地为准');
});

test('mergeAll: 云端为空时等于本地', () => {
  const local = {
    srs: { a: { total: 1 } }, wrong: {}, best: {}, done: 5,
    custom: [], daily: { date: 'Tue', count: 1, goal: 20 },
    streak: { current: 1, best: 1, lastDate: 'Tue' }, settings: {}
  };
  const out = M.mergeAll(local, null);
  assert.equal(out.done, 5);
  assert.ok(out.srs.a);
});
