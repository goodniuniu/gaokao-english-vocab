// ============================================
// 高考英语单词练习 - 主应用逻辑
// ============================================

// ---- 工具函数 ----
function shuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}
function randInt(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[randInt(arr.length)]; }
function $(id) { return document.getElementById(id); }

// ---- 全局状态 ----
var session = [];
var qIdx = 0;
var correctCount = 0;
var wrongThisRound = [];
var currentMode = 'smart';
var flashList = [];
var fIdx = 0;
var flipped = false;
var toastTimer = null;

// ---- 获取完整词库（含自定义词） ----
function getFullBank() {
  var base = window.WORD_BANK || [];
  var custom = Storage.getCustomWords();
  return base.concat(custom);
}

// 根据单词查找完整信息
function findWord(word) {
  var bank = getFullBank();
  for (var i = 0; i < bank.length; i++) {
    if (bank[i].word.toLowerCase() === word.toLowerCase()) return bank[i];
  }
  return null;
}

// ---- 发音 ----
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.85;
  u.pitch = 1;
  window.speechSynthesis.speak(u);
}

// ============================================
// 题目生成引擎
// ============================================
function genMC(mode, fixedWord) {
  var bank = getFullBank();
  var target = fixedWord || pick(bank);
  if (!target) return null;

  var pool = bank.filter(function(w) {
    return w.word !== target.word;
  });
  var wrong = shuffle(pool).slice(0, 3);

  var correctText, options;
  if (mode === 'meaning') {
    correctText = target.meaning;
    options = [target.meaning].concat(wrong.map(function(w) { return w.meaning; }));
  } else {
    correctText = target.word;
    options = [target.word].concat(wrong.map(function(w) { return w.word; }));
  }
  var opts = shuffle(options);
  var answer = opts.indexOf(correctText);
  return { kind: 'mc', mode: mode, target: target, options: opts, answer: answer };
}

function genSpell(fixedWord) {
  var bank = getFullBank();
  var target = fixedWord || pick(bank);
  if (!target) return null;
  return { kind: 'spell', target: target, answer: target.word };
}

function makeQuestion(mode, fixedWord) {
  if (mode === 'spell') return genSpell(fixedWord);
  return genMC(mode, fixedWord);
}

// ============================================
// 首页统计
// ============================================
function refreshStats() {
  var bank = getFullBank();
  var wb = Storage.getWrongBook();
  var wc = Object.keys(wb).length;
  var best = Storage.getBestScores();
  var bestList = Object.keys(best).map(function(k) { return best[k]; }).filter(function(v) { return typeof v === 'number'; });
  var bestPct = bestList.length ? Math.max.apply(null, bestList) : null;
  var srsStats = SRS.getStats(Storage.getSRSData());

  $('sTotal').textContent = bank.length;
  $('sWrong').textContent = wc;
  $('sDone').textContent = Storage.getDoneCount();
  $('sBest').textContent = bestPct == null ? '—' : bestPct + '%';
  $('wbCount').textContent = '共 ' + wc + ' 条 · 点击管理';

  // SRS 统计
  $('sMastered').textContent = srsStats.mastered;
  $('sLearning').textContent = srsStats.learning + srsStats.familiar;
  var progressPct = srsStats.total > 0
    ? Math.round(srsStats.mastered / bank.length * 100)
    : 0;
  $('sProgress').textContent = progressPct + '%';

  // 更新进度环
  var circle = document.getElementById('progressCircle');
  if (circle) {
    var circumference = 2 * Math.PI * 24; // r=24
    var offset = circumference - (progressPct / 100) * circumference;
    circle.style.strokeDashoffset = offset;
  }

  refreshDailyGoal();
}

function refreshDailyGoal() {
  var daily = Storage.getDailyProgress();
  var today = new Date().toDateString();
  if (daily.date !== today) {
    daily = { date: today, count: 0, goal: daily.goal };
    Storage.setDailyProgress(daily);
  }
  $('dgCount').textContent = daily.count;
  $('dgGoal').textContent = daily.goal;
  $('dgLabel').textContent = daily.count >= daily.goal ? '已达标 🎉' : '还差 ' + (daily.goal - daily.count) + ' 题';
}

// ============================================
// 模式入口
// ============================================
function startMode(mode) {
  // 检查是否有当前用户
  if (!Storage.getCurrentUser()) {
    openUserModal();
    toast('请先创建一个学习者');
    return;
  }

  currentMode = mode;
  session = [];

  if (mode === 'flash') {
    return startFlash();
  }

  if (mode === 'wrong') {
    var wb = Storage.getWrongBook();
    var keys = Object.keys(wb);
    if (keys.length === 0) {
      toast('错题本还是空的，先去练几组吧～');
      return;
    }
    var picked = shuffle(keys).slice(0, Math.min(10, keys.length));
    picked.forEach(function(k) {
      var w = findWord(k);
      if (w) session.push(makeQuestion(pick(['meaning', 'word', 'spell']), w));
    });
  } else if (mode === 'smart') {
    // SRS 智能出题
    var srsData = Storage.getSRSData();
    var bank = getFullBank();
    var words = SRS.generateSession(srsData, bank, 10);
    var modes = ['meaning', 'word', 'spell'];
    words.forEach(function(wordKey) {
      var w = findWord(wordKey);
      if (w) {
        session.push(makeQuestion(pick(modes), w));
      }
    });
    // 不足10题时补齐
    if (session.length < 10) {
      for (var i = session.length; i < 10; i++) {
        session.push(makeQuestion(pick(modes)));
      }
    }
  } else if (mode === 'review') {
    // SRS 复习模式：只练到期复习的词
    var srsData = Storage.getSRSData();
    var due = SRS.getDueWords(srsData);
    if (due.length === 0) {
      toast('当前没有需要复习的单词，先学些新词吧～');
      return;
    }
    var picked = shuffle(due).slice(0, Math.min(10, due.length));
    picked.forEach(function(k) {
      var w = findWord(k);
      if (w) session.push(makeQuestion(pick(['meaning', 'word', 'spell']), w));
    });
  } else {
    // 指定模式
    var srsData = Storage.getSRSData();
    var bank = getFullBank();
    var words = SRS.generateSession(srsData, bank, 10);
    words.forEach(function(wordKey) {
      var w = findWord(wordKey);
      if (w) {
        session.push(makeQuestion(mode, w));
      }
    });
    while (session.length < 10) {
      session.push(makeQuestion(mode));
    }
  }

  if (session.length === 0) {
    toast('出题失败，请重试');
    return;
  }

  qIdx = 0;
  correctCount = 0;
  wrongThisRound = [];
  show('quiz');
  renderQuestion();
}

// ============================================
// 答题渲染
// ============================================
function renderQuestion() {
  if (qIdx >= session.length) { finishQuiz(); return; }
  var q = session[qIdx];
  if (!q) { finishQuiz(); return; }

  $('qIdx').textContent = (qIdx + 1) + '/' + session.length;
  $('qBar').style.width = (qIdx / session.length * 100) + '%';

  var modeNames = {
    meaning: '词义选择',
    word: '单词选择',
    spell: '拼写练习',
    smart: '智能组卷',
    review: '复习模式'
  };
  $('qMode').textContent = modeNames[currentMode] || '练习';

  var p = $('qPrompt'), o = $('qOpts'), sp = $('qSpell'), ex = $('qExplain'), sr = $('speakRow');
  ex.classList.add('hidden');
  ex.innerHTML = '';
  o.innerHTML = '';
  sp.classList.add('hidden');
  sp.value = '';
  sp.disabled = false;
  sp.style.borderColor = '';
  sr.classList.add('hidden');
  $('qNext').disabled = true;

  // 绑定发音按钮
  $('speakBtn').onclick = function() { speak(q.target.word); };

  if (q.kind === 'spell') {
    p.innerHTML = '<div class="zh">' + escapeHtml(q.target.meaning) + '</div><div class="ph">' + escapeHtml(q.target.phonetic) + '</div>';
    sp.classList.remove('hidden');
    sp.focus();
    sp.onkeydown = function(e) { if (e.key === 'Enter') submitSpell(); };
  } else {
    if (q.mode === 'meaning') {
      p.innerHTML = '<div>' + escapeHtml(q.target.word) + '</div><div class="ph">' + escapeHtml(q.target.phonetic) + '</div>';
      sr.classList.remove('hidden');
    } else {
      p.innerHTML = '<div class="zh">' + escapeHtml(q.target.meaning) + '</div>';
    }
    q.options.forEach(function(opt, i) {
      var d = document.createElement('div');
      d.className = 'opt';
      d.innerHTML = '<span class="opt-key">' + String.fromCharCode(65 + i) + '</span><span>' + escapeHtml(opt) + '</span>';
      d.onclick = function() { chooseMC(i); };
      o.appendChild(d);
    });
  }

  // 自动朗读
  var settings = Storage.getSettings();
  if (settings.autoSpeak) {
    setTimeout(function() { speak(q.target.word); }, 300);
  }
}

function chooseMC(i) {
  var q = session[qIdx];
  var opts = document.querySelectorAll('#qOpts .opt');
  var isRight = (i === q.answer);

  opts.forEach(function(el, idx) {
    el.onclick = null;
    if (idx === q.answer) el.classList.add('correct');
    else if (idx === i) el.classList.add('wrong');
    else el.classList.add('dim');
  });

  afterAnswer(isRight, q.target);
}

function submitSpell() {
  var q = session[qIdx];
  var val = $('qSpell').value.trim().toLowerCase();
  var isRight = (val === q.target.word.toLowerCase());
  var sp = $('qSpell');
  sp.disabled = true;
  if (isRight) sp.style.borderColor = 'var(--ok)';
  else sp.style.borderColor = 'var(--warn)';
  afterAnswer(isRight, q.target);
}

function afterAnswer(isRight, target) {
  if (isRight) {
    correctCount++;
  } else {
    // 加入错题本
    var wb = Storage.getWrongBook();
    var key = target.word.toLowerCase();
    if (wb[key]) {
      wb[key].wrong = (wb[key].wrong || 0) + 1;
    } else {
      wb[key] = {
        word: target.word,
        phonetic: target.phonetic,
        pos: target.pos,
        meaning: target.meaning,
        exampleEn: target.exampleEn || '',
        exampleZh: target.exampleZh || '',
        wrong: 1
      };
    }
    Storage.setWrongBook(wb);
    wrongThisRound.push(target.word);
  }

  // 更新 SRS
  var srsData = Storage.getSRSData();
  SRS.updateRecord(srsData, target.word, isRight);
  Storage.setSRSData(srsData);

  // 更新每日进度
  var daily = Storage.getDailyProgress();
  var today = new Date().toDateString();
  if (daily.date !== today) { daily = { date: today, count: 0, goal: daily.goal }; }
  daily.count++;
  Storage.setDailyProgress(daily);

  // 显示解析
  var ex = $('qExplain');
  ex.classList.remove('hidden');
  var exHtml = '<div class="w">' + escapeHtml(target.word) + ' <span class="ph">' + escapeHtml(target.phonetic) + '</span></div>';
  exHtml += '<div>' + escapeHtml(target.meaning) + '</div>';
  if (target.exampleEn) {
    exHtml += '<div class="ex"><b>' + escapeHtml(target.exampleEn) + '</b><br>' + escapeHtml(target.exampleZh || '') + '</div>';
  }
  ex.innerHTML = exHtml;

  // 显示发音
  $('speakRow').classList.remove('hidden');

  $('qNext').disabled = false;
  $('qNext').focus();
  refreshStats();

  // 标记需要云同步
  if (typeof Sync !== 'undefined') Sync.markPending();
}

function nextQuestion() {
  if (qIdx < session.length - 1) {
    qIdx++;
    renderQuestion();
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  var total = session.length;
  var pct = Math.round(correctCount / total * 100);

  var best = Storage.getBestScores();
  var key = currentMode;
  var isNewBest = false;
  if (!(key in best) || pct > best[key]) {
    best[key] = pct;
    isNewBest = true;
  }
  Storage.setBestScores(best);
  Storage.setDoneCount(Storage.getDoneCount() + total);

  $('rScore').textContent = correctCount + '/' + total;
  $('rSub').textContent = '正确率 ' + pct + '%';

  var modeNames = {
    meaning: '词义选择', word: '单词选择', spell: '拼写练习',
    smart: '智能组卷', review: '复习模式', wrong: '错题复习'
  };

  var badges = '';
  if (isNewBest) badges += '<span class="result-badge gold">🎉 新纪录</span>';
  if (pct === 100) badges += '<span class="result-badge gold">满分！</span>';
  if (pct >= 80) badges += '<span class="result-badge green">优秀</span>';
  badges += '<span class="result-badge">' + (modeNames[currentMode] || '练习') + '</span>';

  $('rBadges').innerHTML = badges;

  show('result');
  refreshStats();
}

function retry() { startMode(currentMode); }

// ============================================
// 错题本
// ============================================
function showWrong() {
  var wb = Storage.getWrongBook();
  var keys = Object.keys(wb);
  var list = $('wbList');
  list.innerHTML = '';

  if (keys.length === 0) {
    list.innerHTML = '<p class="center" style="color:var(--sub);padding:20px">还没有错题，去练一组吧 💪</p>';
  } else {
    keys.sort();
    keys.forEach(function(k) {
      var w = wb[k];
      var d = document.createElement('div');
      d.className = 'wb-item';
      var html = '<div class="wb-row">';
      html += '<div style="flex:1">';
      html += '<div class="w">' + escapeHtml(w.word) + '</div>';
      html += '<div class="ph">' + escapeHtml(w.phonetic) + ' · ' + escapeHtml(w.pos) + '</div>';
      html += '<div class="m">' + escapeHtml(w.meaning) + '</div>';
      if (w.exampleEn) {
        html += '<div class="ex">' + escapeHtml(w.exampleEn) + '<br>' + escapeHtml(w.exampleZh || '') + '</div>';
      }
      html += '</div>';
      if (w.wrong > 1) {
        html += '<span class="wrong-count">错' + w.wrong + '次</span>';
      }
      html += '</div>';
      html += '<div class="actions">';
      html += '<button class="mini-btn" onclick="speakWord(\'' + escapeAttr(w.word) + '\')">🔊 朗读</button>';
      html += '<button class="mini-btn danger" onclick="removeWrong(\'' + escapeAttr(k) + '\')">移除</button>';
      html += '</div>';
      d.innerHTML = html;
      list.appendChild(d);
    });
  }
  show('wrongbook');
}

function filterWrong() {
  var q = $('wbSearch').value.toLowerCase();
  var items = document.querySelectorAll('#wbList .wb-item');
  items.forEach(function(el) {
    var text = el.textContent.toLowerCase();
    el.style.display = text.indexOf(q) !== -1 ? '' : 'none';
  });
}

function removeWrong(key) {
  var wb = Storage.getWrongBook();
  delete wb[key];
  Storage.setWrongBook(wb);
  showWrong();
  refreshStats();
  toast('已从错题本移除');
  if (typeof Sync !== 'undefined') Sync.markPending();
}

function clearWrong() {
  if (!confirm('确定清空错题本？此操作不可恢复。')) return;
  Storage.setWrongBook({});
  refreshStats();
  showWrong();
  toast('已清空');
}

function speakWord(word) { speak(word); }

// ============================================
// 卡片学习
// ============================================
function startFlash() {
  var bank = getFullBank();
  var srsData = Storage.getSRSData();

  // 优先展示：到期复习词 + 新词，然后才是已学过的词
  var dueWords = SRS.getDueWords(srsData);
  var newWords = SRS.getNewWords(srsData, bank, 999);
  var learnedKeys = Object.keys(srsData).filter(function(k) {
    return dueWords.indexOf(k) === -1;
  });

  // 按优先级排序：复习词 → 新词 → 已学词
  flashList = [];
  var seen = {};

  dueWords.forEach(function(k) {
    var w = findWord(k);
    if (w && !seen[k]) { flashList.push(w); seen[k] = true; }
  });
  newWords.forEach(function(k) {
    var w = findWord(k);
    if (w && !seen[k.toLowerCase()]) { flashList.push(w); seen[k.toLowerCase()] = true; }
  });
  // 补充剩余已学词（随机）
  shuffle(learnedKeys).forEach(function(k) {
    var w = findWord(k);
    if (w && !seen[k]) { flashList.push(w); seen[k] = true; }
  });

  // 如果词太少（比如全库已学完），补充全部
  if (flashList.length < 20) {
    bank.forEach(function(w) {
      var k = w.word.toLowerCase();
      if (!seen[k]) { flashList.push(w); seen[k] = true; }
    });
  }

  fIdx = 0;
  flipped = false;
  $('fIdx').textContent = '1/' + flashList.length;
  $('fBar').style.width = '0%';
  renderFlash();
  show('flash');
}

function renderFlash() {
  var w = flashList[fIdx];
  $('fWord').textContent = w.word;
  $('fPh').textContent = w.phonetic;
  $('fPos').textContent = w.pos;

  // SRS 状态徽章
  var srsData = Storage.getSRSData();
  var rec = srsData[w.word.toLowerCase()];
  var badge = $('fSrsBadge');
  if (rec && rec.total > 0) {
    var levelNames = {
      0: { text: '新词', cls: 'new' },
      1: { text: '学习中', cls: 'learning' },
      2: { text: '熟悉中', cls: 'familiar' },
      3: { text: '已掌握', cls: 'mastered' }
    };
    var info = levelNames[rec.level] || levelNames[0];
    badge.className = 'srs-badge ' + info.cls;
    badge.textContent = info.text + ' · 答对' + rec.correct + '/' + rec.total;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  if (flipped) {
    $('fMean').classList.remove('hidden');
    $('fMean').textContent = w.meaning;
    $('fHint').textContent = '给自己打个分吧 👇';
    if (w.exampleEn) {
      $('fExample').classList.remove('hidden');
      $('fExample').innerHTML = '<b>' + escapeHtml(w.exampleEn) + '</b><br>' + escapeHtml(w.exampleZh || '');
    } else {
      $('fExample').classList.add('hidden');
    }
    // 翻面后显示评级按钮
    $('fRateBtns').classList.remove('hidden');
    $('fStatus').textContent = '翻面 · 评级';
  } else {
    $('fMean').classList.add('hidden');
    $('fExample').classList.add('hidden');
    $('fHint').textContent = '点击卡片看释义';
    $('fRateBtns').classList.add('hidden');
    var dueCount = SRS.getDueWords(srsData).length;
    $('fStatus').textContent = dueCount > 0 ? '卡片学习 · ' + dueCount + '词待复习' : '卡片学习';
  }

  $('fIdx').textContent = (fIdx + 1) + '/' + flashList.length;
  $('fBar').style.width = (fIdx / Math.max(flashList.length - 1, 1) * 100) + '%';
}

function flip() {
  flipped = !flipped;
  renderFlash();
}

function flashNav(d) {
  fIdx = (fIdx + d + flashList.length) % flashList.length;
  flipped = false;
  renderFlash();
}

// 卡片评级：认识/不认识 → 更新 SRS → 自动翻到下一个
function flashRate(known) {
  var w = flashList[fIdx];

  // 更新 SRS 记录
  var srsData = Storage.getSRSData();
  SRS.updateRecord(srsData, w.word, known);
  Storage.setSRSData(srsData);

  // 不认识的词加入错题本
  if (!known) {
    var wb = Storage.getWrongBook();
    var key = w.word.toLowerCase();
    if (wb[key]) {
      wb[key].wrong = (wb[key].wrong || 0) + 1;
    } else {
      wb[key] = {
        word: w.word,
        phonetic: w.phonetic,
        pos: w.pos,
        meaning: w.meaning,
        exampleEn: w.exampleEn || '',
        exampleZh: w.exampleZh || '',
        wrong: 1
      };
    }
    Storage.setWrongBook(wb);
  }

  // 更新每日进度
  var daily = Storage.getDailyProgress();
  var today = new Date().toDateString();
  if (daily.date !== today) { daily = { date: today, count: 0, goal: daily.goal }; }
  daily.count++;
  Storage.setDailyProgress(daily);

  // 标记云同步
  if (typeof Sync !== 'undefined') Sync.markPending();

  // 短暂反馈后自动翻到下一个
  toast(known ? '✅ 认识' : '❌ 不认识，已加入复习');
  setTimeout(function() {
    flashNav(1);
  }, 400);
}

// ============================================
// 自定义单词管理
// ============================================
function openCustomModal(mode, word) {
  var isEdit = !!word;
  $('customModalTitle').textContent = isEdit ? '编辑自定义单词' : '添加自定义单词';
  $('cwWord').value = isEdit ? word.word : '';
  $('cwPhonetic').value = isEdit ? word.phonetic : '';
  $('cwPos').value = isEdit ? word.pos : '';
  $('cwMeaning').value = isEdit ? word.meaning : '';
  $('cwExampleEn').value = isEdit ? (word.exampleEn || '') : '';
  $('cwExampleZh').value = isEdit ? (word.exampleZh || '') : '';

  $('cwSave').onclick = function() { saveCustomWord(isEdit ? word.word : null); };
  showModal('customModal');
}

function saveCustomWord(oldWord) {
  var word = $('cwWord').value.trim();
  var phonetic = $('cwPhonetic').value.trim();
  var pos = $('cwPos').value.trim();
  var meaning = $('cwMeaning').value.trim();
  var exampleEn = $('cwExampleEn').value.trim();
  var exampleZh = $('cwExampleZh').value.trim();

  if (!word || !meaning) {
    toast('单词和释义不能为空');
    return;
  }

  var custom = Storage.getCustomWords();

  // 如果是编辑，先移除旧的
  if (oldWord) {
    custom = custom.filter(function(w) { return w.word !== oldWord; });
  }

  // 检查重复（含系统词库）
  var bank = window.WORD_BANK || [];
  for (var i = 0; i < bank.length; i++) {
    if (bank[i].word.toLowerCase() === word.toLowerCase()) {
      toast('该单词已存在于系统词库中');
      return;
    }
  }
  for (var i = 0; i < custom.length; i++) {
    if (custom[i].word.toLowerCase() === word.toLowerCase()) {
      toast('该单词已添加过');
      return;
    }
  }

  custom.push({
    word: word,
    phonetic: phonetic || '',
    pos: pos || '',
    meaning: meaning,
    exampleEn: exampleEn,
    exampleZh: exampleZh
  });

  Storage.setCustomWords(custom);
  hideModal('customModal');
  toast(oldWord ? '已更新' : '已添加');
  renderCustomWords();
  refreshStats();
  if (typeof Sync !== 'undefined') Sync.markPending();
}

function renderCustomWords() {
  var custom = Storage.getCustomWords();
  var list = $('cwList');
  list.innerHTML = '';

  if (custom.length === 0) {
    list.innerHTML = '<p class="center" style="color:var(--sub);padding:20px">还没有自定义单词，点击上方按钮添加 ✍️</p>';
    return;
  }

  custom.sort(function(a, b) { return a.word.localeCompare(b.word); });

  custom.forEach(function(w) {
    var d = document.createElement('div');
    d.className = 'wb-item';
    var html = '<div class="wb-row"><div style="flex:1">';
    html += '<div class="w">' + escapeHtml(w.word) + '</div>';
    if (w.phonetic) html += '<div class="ph">' + escapeHtml(w.phonetic) + ' · ' + escapeHtml(w.pos) + '</div>';
    html += '<div class="m">' + escapeHtml(w.meaning) + '</div>';
    if (w.exampleEn) html += '<div class="ex">' + escapeHtml(w.exampleEn) + '<br>' + escapeHtml(w.exampleZh || '') + '</div>';
    html += '</div></div>';
    html += '<div class="actions">';
    html += '<button class="mini-btn" data-speak="' + escapeAttr(w.word) + '">🔊</button>';
    html += '<button class="mini-btn" data-edit="' + escapeAttr(w.word) + '">编辑</button>';
    html += '<button class="mini-btn danger" onclick="deleteCustomWord(\'' + escapeAttr(w.word) + '\')">删除</button>';
    html += '</div>';
    d.innerHTML = html;
    list.appendChild(d);
  });

  // 事件委托
  list.querySelectorAll('[data-speak]').forEach(function(btn) {
    btn.onclick = function() { speak(this.getAttribute('data-speak')); };
  });
  list.querySelectorAll('[data-edit]').forEach(function(btn) {
    btn.onclick = function() {
      var word = this.getAttribute('data-edit');
      var custom = Storage.getCustomWords();
      var found = custom.find(function(w) { return w.word === word; });
      if (found) openCustomModal('edit', found);
    };
  });
}

function deleteCustomWord(word) {
  if (!confirm('确定删除 "' + word + '" ？')) return;
  var custom = Storage.getCustomWords();
  custom = custom.filter(function(w) { return w.word !== word; });
  Storage.setCustomWords(custom);
  renderCustomWords();
  refreshStats();
  toast('已删除');
  if (typeof Sync !== 'undefined') Sync.markPending();
}

// ============================================
// 用户管理
// ============================================
function refreshUserBadge() {
  var uid = Storage.getCurrentUser();
  var users = Storage.getUsers();
  var badge = $('userBadge');

  if (uid && users[uid]) {
    var name = users[uid].name;
    badge.innerHTML = '<span class="avatar">' + escapeHtml(name.charAt(0).toUpperCase()) + '</span><span class="name">' + escapeHtml(name) + '</span>';
    badge.onclick = function() { openUserModal(); };
  } else {
    badge.innerHTML = '<span class="avatar">+</span><span class="name">点击登录</span>';
    badge.onclick = function() { openUserModal(); };
  }
}

function openUserModal() {
  var users = Storage.getUsers();
  var currentUid = Storage.getCurrentUser();
  var list = $('userList');
  list.innerHTML = '';

  var keys = Object.keys(users);
  if (keys.length === 0) {
    list.innerHTML = '<p class="center" style="color:var(--sub);padding:16px 0">还没有学习者，创建一个吧！</p>';
  } else {
    keys.forEach(function(uid) {
      var u = users[uid];
      var d = document.createElement('div');
      d.className = 'user-list-item' + (uid === currentUid ? ' active' : '');
      var srsData = Storage.getSRSData();
      // Note: getSRSData is for current user, so we need custom read
      var srsRaw;
      try {
        srsRaw = JSON.parse(localStorage.getItem('gev_' + uid + '_srs') || '{}');
      } catch(e) { srsRaw = {}; }
      var srsStats = SRS.getStats(srsRaw);
      d.innerHTML = '<div class="avatar">' + escapeHtml(u.name.charAt(0).toUpperCase()) + '</div>'
        + '<div class="info"><div class="n">' + escapeHtml(u.name) + '</div>'
        + '<div class="s">已学 ' + srsStats.total + ' · 已掌握 ' + srsStats.mastered + '</div></div>';
      d.onclick = function() { selectUser(uid); };
      list.appendChild(d);
    });
  }

  showModal('userModal');
}

function selectUser(uid) {
  Storage.setCurrentUser(uid);
  hideModal('userModal');
  refreshUserBadge();
  refreshStats();
  toast('已切换用户');
}

function createNewUser() {
  var name = $('newUserName').value.trim();
  if (!name) {
    toast('请输入名字');
    return;
  }
  var uid = Storage.createUser(name);
  Storage.setCurrentUser(uid);
  $('newUserName').value = '';
  hideModal('userModal');
  refreshUserBadge();
  refreshStats();
  toast('欢迎，' + name + '！');
}

// ============================================
// 设置
// ============================================
function toggleTheme() {
  var theme = Storage.getTheme();
  var newTheme = theme === 'dark' ? 'light' : 'dark';
  Storage.setTheme(newTheme);
  applyTheme();
}

function applyTheme() {
  var theme = Storage.getTheme();
  document.documentElement.setAttribute('data-theme', theme);
  $('themeBtn').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function openSettings() {
  var settings = Storage.getSettings();
  $('toggleAutoSpeak').classList.toggle('on', settings.autoSpeak);
  $('toggleShortcuts').classList.toggle('on', settings.keyboardShortcuts);

  $('toggleAutoSpeak').onclick = function() {
    settings.autoSpeak = !settings.autoSpeak;
    Storage.setSettings(settings);
    this.classList.toggle('on', settings.autoSpeak);
  };

  $('toggleShortcuts').onclick = function() {
    settings.keyboardShortcuts = !settings.keyboardShortcuts;
    Storage.setSettings(settings);
    this.classList.toggle('on', settings.keyboardShortcuts);
  };

  // 显示每日目标
  var daily = Storage.getDailyProgress();
  $('dailyGoalInput').value = daily.goal;
  $('saveDailyGoal').onclick = function() {
    var val = parseInt($('dailyGoalInput').value, 10);
    if (val > 0 && val <= 200) {
      daily.goal = val;
      Storage.setDailyProgress(daily);
      toast('已保存');
      refreshStats();
    }
  };

  // 云同步状态
  refreshSyncPanel();

  showModal('settingsModal');
}

// ============================================
// 云同步功能
// ============================================
function refreshSyncPanel() {
  var configured = Sync.isConfigured();
  var hasCode = !!Sync.getSyncCode();
  var panel = $('syncPanel');

  if (!panel) return;

  if (!configured) {
    // 未配置服务器
    panel.innerHTML = '<div style="padding:12px 0"><div style="font-size:13px;color:var(--sub);margin-bottom:8px">需要先填写 Worker 地址才能启用云同步</div>'
      + '<label>Worker API 地址</label>'
      + '<input type="text" id="syncApiBase" placeholder="https://xxx.your-subdomain.workers.dev" style="margin-top:4px" />'
      + '<button class="btn" style="margin-top:10px" onclick="saveApiBase()">保存地址</button></div>';
  } else if (!hasCode) {
    // 已配置但未注册
    panel.innerHTML = '<div style="padding:12px 0"><div style="font-size:13px;color:var(--sub);margin-bottom:8px">服务器已连接: ' + escapeHtml(Sync.getApiBase()) + '</div>'
      + '<div class="sync-tabs" style="display:flex;gap:8px;margin-bottom:12px">'
      + '<button class="btn ghost" style="flex:1;padding:10px;font-size:13px" id="tabRegister" onclick="showSyncTab(\'register\')">注册新账号</button>'
      + '<button class="btn ghost" style="flex:1;padding:10px;font-size:13px" id="tabLogin" onclick="showSyncTab(\'login\')">用同步码登录</button>'
      + '</div>'
      + '<div id="syncTabRegister">'
      + '<label>创建名字</label>'
      + '<input type="text" id="syncRegName" placeholder="输入名字" maxlength="12" />'
      + '<button class="btn" style="margin-top:10px" onclick="doRegister()">注册并获取同步码</button>'
      + '</div>'
      + '<div id="syncTabLogin" class="hidden">'
      + '<label>同步码（6位）</label>'
      + '<input type="text" id="syncLoginCode" placeholder="如：AB3XK9" maxlength="6" style="text-transform:uppercase" />'
      + '<button class="btn" style="margin-top:10px" onclick="doLogin()">恢复数据</button>'
      + '</div></div>';
    showSyncTab('register');
  } else {
    // 已同步
    var name = Sync.getSyncName() || '已同步';
    panel.innerHTML = '<div style="padding:12px 0">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
      + '<span style="font-size:20px">☁️</span>'
      + '<div><div style="font-weight:700;font-size:14px">' + escapeHtml(name) + '</div>'
      + '<div style="font-size:12px;color:var(--sub)">同步码: <b style="color:var(--brand);letter-spacing:1px">' + Sync.getSyncCode() + '</b></div></div>'
      + '</div>'
      + '<div style="display:flex;gap:8px">'
      + '<button class="btn ghost" style="flex:1;padding:10px;font-size:13px" onclick="doManualSync()">立即同步</button>'
      + '<button class="btn ghost" style="flex:1;padding:10px;font-size:13px;color:var(--warn)" onclick="doDisconnect()">断开同步</button>'
      + '</div>'
      + '<div style="font-size:11px;color:var(--sub);margin-top:8px">同步码是跨设备恢复数据的钥匙，请记好</div>'
      + '</div>';
  }
}

function showSyncTab(tab) {
  var reg = $('syncTabRegister');
  var login = $('syncTabLogin');
  if (!reg || !login) return;

  reg.classList.toggle('hidden', tab !== 'register');
  login.classList.toggle('hidden', tab !== 'login');

  $('tabRegister').style.background = tab === 'register' ? 'var(--brand)' : '';
  $('tabRegister').style.color = tab === 'register' ? '#fff' : '';
  $('tabLogin').style.background = tab === 'login' ? 'var(--brand)' : '';
  $('tabLogin').style.color = tab === 'login' ? '#fff' : '';
}

function saveApiBase() {
  var url = $('syncApiBase').value.trim();
  if (!url) { toast('请输入地址'); return; }
  if (!url.startsWith('http')) { toast('地址需以 http 开头'); return; }
  Sync.setApiBase(url);
  toast('地址已保存');
  refreshSyncPanel();
}

async function doRegister() {
  var name = $('syncRegName').value.trim();
  if (!name) { toast('请输入名字'); return; }

  try {
    toast('注册中...');
    var data = await Sync.register(name);
    if (data.ok) {
      toast('注册成功！同步码: ' + data.syncCode);
      Sync.startAutoSync();
      refreshSyncPanel();
    } else {
      toast(data.error || '注册失败');
    }
  } catch(e) {
    toast('注册失败: ' + e.message);
  }
}

async function doLogin() {
  var code = $('syncLoginCode').value.trim().toUpperCase();
  if (!code || code.length !== 6) { toast('请输入6位同步码'); return; }

  try {
    toast('正在恢复数据...');
    var data = await Sync.pull(code);
    if (data.ok) {
      toast('数据恢复成功！');
      refreshSyncPanel();
      refreshUserBadge();
      refreshStats();
      Sync.startAutoSync();
    }
  } catch(e) {
    toast('恢复失败: ' + e.message);
  }
}

async function doManualSync() {
  try {
    toast('同步中...');
    await Sync.uploadAll();
    toast('同步完成');
  } catch(e) {
    toast('同步失败: ' + e.message);
  }
}

function doDisconnect() {
  if (!confirm('断开同步后，本设备数据仍保留，但不再自动同步。确定？')) return;
  Sync.disconnect();
  toast('已断开同步');
  refreshSyncPanel();
}

// ============================================
// 导航
// ============================================
function show(name) {
  ['home', 'quiz', 'result', 'wrongbook', 'flash', 'custom'].forEach(function(n) {
    var el = $(n);
    if (el) {
      el.classList.toggle('hidden', n !== name);
      if (n === name) el.classList.add('view-enter');
    }
  });
  window.scrollTo(0, 0);
}

function goHome() {
  show('home');
  refreshStats();
}

function showCustom() {
  renderCustomWords();
  show('custom');
}

// ============================================
// Modal
// ============================================
function showModal(id) {
  $(id).classList.add('show');
}

function hideModal(id) {
  $(id).classList.remove('show');
}

// ============================================
// Toast
// ============================================
function toast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { t.classList.remove('show'); }, 1800);
}

// ============================================
// 安全工具
// ============================================
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  if (!s) return '';
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ============================================
// 键盘快捷键
// ============================================
document.addEventListener('keydown', function(e) {
  var settings = Storage.getSettings();
  if (!settings.keyboardShortcuts) return;

  // 答题中：A/B/C/D 或 1/2/3/4 选答案
  if (!$('quiz').classList.contains('hidden')) {
    if ($('qNext').disabled) {
      // 未答：选择选项
      var key = e.key.toUpperCase();
      var idx = -1;
      if (key >= 'A' && key <= 'D') idx = key.charCodeAt(0) - 65;
      else if (key >= '1' && key <= '4') idx = parseInt(key) - 1;

      if (idx >= 0) {
        var opts = document.querySelectorAll('#qOpts .opt');
        if (opts[idx] && !opts[idx].onclick == null) {
          opts[idx].click();
        } else if (opts[idx]) {
          opts[idx].click();
        }
      }
    } else {
      // 已答：Enter/Space 下一题
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        $('qNext').click();
      }
    }
  }

  // 卡片中：空格翻面，1=不认识 2=认识，左右箭头切换
  if (!$('flash').classList.contains('hidden')) {
    if (e.key === ' ') { e.preventDefault(); flip(); }
    else if (e.key === '1' && flipped) { e.preventDefault(); flashRate(false); }
    else if (e.key === '2' && flipped) { e.preventDefault(); flashRate(true); }
    else if (e.key === 'ArrowLeft') flashNav(-1);
    else if (e.key === 'ArrowRight') flashNav(1);
  }

  // Esc 关闭 Modal
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.show').forEach(function(m) {
      m.classList.remove('show');
    });
  }
});

// ============================================
// 初始化
// ============================================
function init() {
  applyTheme();

  // 如果没有用户，自动弹出创建
  var uid = Storage.getCurrentUser();
  var users = Storage.getUsers();
  if (!uid || !users[uid]) {
    if (Object.keys(users).length === 0) {
      setTimeout(function() { openUserModal(); }, 500);
    }
  }

  refreshUserBadge();
  refreshStats();

  // 如果已配置云同步，启动自动同步
  if (typeof Sync !== 'undefined' && Sync.isConfigured() && Sync.getSyncCode()) {
    Sync.startAutoSync();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
