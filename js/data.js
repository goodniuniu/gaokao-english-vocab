// ============================================
// 数据加载与合并模块
// ============================================

const ALL_RAW = [].concat(
  window.VOCAB_A || [],
  window.VOCAB_F || [],
  window.VOCAB_K || [],
  window.VOCAB_P || [],
  window.VOCAB_U || []
);

// 转为对象格式
const BANK = ALL_RAW.map(function(arr) {
  return {
    word: arr[0],
    phonetic: arr[1],
    pos: arr[2],
    meaning: arr[3],
    exampleEn: arr[4] || '',
    exampleZh: arr[5] || ''
  };
});

// 去重（以 word 为 key，保留第一个）
var _seen = {};
var DEDUPED = [];
for (var i = 0; i < BANK.length; i++) {
  var w = BANK[i].word.toLowerCase();
  if (!_seen[w]) {
    _seen[w] = true;
    DEDUPED.push(BANK[i]);
  }
}

// 全局词库
window.WORD_BANK = DEDUPED;
window.TOTAL_WORDS = DEDUPED.length;
