#!/usr/bin/env node
/**
 * 例句补充脚本
 * ====================================================
 * 用 kajweb/dict 项目的人教版/北师大版高中词库数据，
 * 补充 supp-*.js 中缺失词性、例句、翻译的单词条目。
 *
 * 数据来源：https://github.com/kajweb/dict
 * 原始数据：有道词典（人教版 + 北师大版高中教材词汇）
 *
 * 策略：
 *   - 只补充缺失字段（pos, exampleEn, exampleZh），不动 word/phonetic/meaning
 *   - 多条例句选最短的（更适合卡片显示，移动端体验好）
 *   - 匹配：headWord 小写完全相等
 *   - 不创建新单词（保持现有 3500 词规模不变）
 *
 * 用法：
 *   cd /path/to/gaokao-english-vocab
 *   node scripts/fill-examples.js
 *
 * 默认 dry-run，加 --apply 才实际写入。
 */

const fs = require('fs');
const path = require('path');

// ===== 配置 =====
const PROJECT_ROOT = path.resolve(__dirname, '..');
const KAJWEB_EXTRACT = '/tmp/extract-test';  // 已解压的 kajweb JSON
const SUPP_FILES = [
  'js/data/supp-ae.js',
  'js/data/supp-fj.js',
  'js/data/supp-ko.js',
  'js/data/supp-pt.js',
  'js/data/supp-uz.js',
];

const APPLY = process.argv.includes('--apply');

// ===== 工具 =====
function readJsonl(filePath) {
  // kajweb 的 JSON 是每行一个对象（JSONL 格式）
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
  return lines.map(line => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);
}

// 从 kajweb 单词对象提取我们需要的数据
function extractFromKajweb(entry) {
  const headWord = entry.headWord || '';
  const content = entry?.content?.word?.content;
  if (!content) return null;

  // 例句（取所有，再选最短的）
  const sentences = content?.sentence?.sentences || [];
  const examples = sentences
    .filter(s => s.sContent && s.sCn)
    .map(s => ({ en: s.sContent.trim(), zh: s.sCn.trim() }))
    .filter(s => s.en && s.zh);

  // 例句选择策略：选长度最短且 < 100 字符的（更适合卡片）
  let bestExample = null;
  if (examples.length > 0) {
    const sorted = [...examples].sort((a, b) => a.en.length - b.en.length);
    // 优先选长度 30-80 的（不要太短像词组、不要太长像段落）
    const ideal = sorted.find(e => e.en.length >= 30 && e.en.length <= 80);
    bestExample = ideal || sorted[0];
  }

  // 词性 + 中文释义
  const trans = content?.trans || [];
  const posList = trans
    .map(t => t.pos)
    .filter(Boolean)
    .map(p => p.trim())
    .filter(p => p.length > 0 && p.length <= 10);
  const pos = posList.length > 0 ? [...new Set(posList)].join('/') : '';

  return {
    headWord: headWord.toLowerCase(),
    pos,
    exampleEn: bestExample?.en || '',
    exampleZh: bestExample?.zh || '',
    exampleCount: examples.length,
  };
}

// 解析 supp-*.js，返回 [entries, header, footer]
function parseSuppFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  // 文件结构：
  //   // 注释
  //   window.VOCAB_X_SUPP = [
  //     ["word", ...],
  //     ...
  //   ];
  // 找到 `window.X = [` 起点和 `];` 终点（最后一个 `];`）
  const startMatch = src.match(/^(window\.\w+\s*=\s*\[)/m);
  if (!startMatch) {
    throw new Error(`${filePath}: 找不到 window.XXX = [ 起点`);
  }
  const startIdx = startMatch.index;
  const header = src.slice(0, startIdx + startMatch[0].length);

  // 找文件末尾的 `];`
  const endMatch = src.match(/\];\s*$/);
  if (!endMatch) {
    throw new Error(`${filePath}: 找不到文件末尾的 ];`);
  }
  const endIdx = endMatch.index;
  const footer = src.slice(endIdx);
  const body = src.slice(startIdx + startMatch[0].length, endIdx);

  // 解析每一条 ["word","phon","pos","meaning","ex","exZh"]
  const entryRe = /\["((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)"\]/g;
  const entries = [];
  let m;
  let lastIdx = 0;
  const segments = []; // 保留条目之间的空白和注释
  while ((m = entryRe.exec(body)) !== null) {
    if (m.index > lastIdx) {
      segments.push({ type: 'text', value: body.slice(lastIdx, m.index) });
    }
    const fields = m.slice(1).map(s => s.replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    entries.push({
      word: fields[0],
      phonetic: fields[1],
      pos: fields[2],
      meaning: fields[3],
      exampleEn: fields[4],
      exampleZh: fields[5],
      index: entries.length,
    });
    segments.push({ type: 'entry', index: entries.length - 1 });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < body.length) {
    segments.push({ type: 'text', value: body.slice(lastIdx) });
  }

  return { header, footer, entries, segments };
}

function escapeForStr(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function regenerateSuppFile(header, footer, entries, segments) {
  const entryByIdx = entries;
  let body = '';
  for (const seg of segments) {
    if (seg.type === 'text') {
      body += seg.value;
    } else {
      const e = entryByIdx[seg.index];
      body += `["${escapeForStr(e.word)}","${escapeForStr(e.phonetic)}","${escapeForStr(e.pos)}","${escapeForStr(e.meaning)}","${escapeForStr(e.exampleEn)}","${escapeForStr(e.exampleZh)}"]`;
    }
  }
  return header + body + footer;
}

// ===== 主流程 =====
console.log('=== 1. 加载 kajweb/dict 高中 + CET4/6 + 考研词库 ===');

if (!fs.existsSync(KAJWEB_EXTRACT)) {
  console.error(`错误：${KAJWEB_EXTRACT} 不存在，请先运行探查脚本`);
  process.exit(1);
}

// 加载顺序：先高中，再 CET4，再 CET6，再考研
// 高中数据例句最贴切（面向初学者）；CET 兜底
const FILE_PATTERN = /GaoZhong|CET4|CET6|KaoYan/i;
const kajwebFiles = fs.readdirSync(KAJWEB_EXTRACT)
  .filter(f => f.endsWith('.json') && FILE_PATTERN.test(f))
  .map(f => path.join(KAJWEB_EXTRACT, f));

console.log(`  共 ${kajwebFiles.length} 个词库文件（高中 + CET4/6 + 考研）`);

// 构建 word → data 索引
const kajwebIndex = new Map();  // lower-case word → data
const kajwebStems = new Map();  // stem → full word（词干兜底用）
let totalKajwebWords = 0;
let priorityRank = { GaoZhong: 1, CET4: 2, CET6: 3, KaoYan: 4 };

function priorityOf(filePath) {
  for (const key of Object.keys(priorityRank)) {
    if (filePath.includes(key)) return priorityRank[key];
  }
  return 99;
}

for (const f of kajwebFiles) {
  const priority = priorityOf(f);
  const entries = readJsonl(f);
  totalKajwebWords += entries.length;
  for (const entry of entries) {
    const extracted = extractFromKajweb(entry);
    if (!extracted) continue;
    const word = extracted.headWord;

    // 索引到 kajwebIndex（高优先级覆盖低优先级）
    const existing = kajwebIndex.get(word);
    if (!existing || priority < existing.priority) {
      kajwebIndex.set(word, { ...extracted, priority });
    }

    // 同时索引到 kajwebStems（词干兜底）
    for (const stem of simpleStems(word)) {
      if (!kajwebStems.has(stem)) {
        kajwebStems.set(stem, word);
      }
    }
  }
}

// 简单词干提取（只去常见后缀）
function simpleStems(w) {
  w = w.toLowerCase();
  const out = new Set([w]);
  for (const suf of ['ied', 'ies', 'iest', 'ing', 'ed', 'er', 'est', 'ly', 's']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      let stem = w.slice(0, -suf.length);
      out.add(stem);
      // y 结尾的还原
      if (suf.startsWith('ie')) out.add(stem + 'y');
      // 双辅音还原（running → run）
      if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2] && 'bdfgmnprt'.includes(stem[stem.length - 1])) {
        out.add(stem.slice(0, -1));
      }
    }
  }
  return out;
}

// 统计：精确词数 vs 词干索引
console.log(`  kajweb 词库共 ${totalKajwebWords} 条`);
console.log(`  去重后 kajwebIndex：${kajwebIndex.size} 个有例句词`);
console.log();

console.log('=== 2. 扫描 supp-*.js 缺例句的条目 ===');

let totalMissing = 0;
let totalExactMatched = 0;  // 精确匹配
let totalStemMatched = 0;   // 词干兜底
let totalUnmatched = 0;
const unmatched = [];
const matchedSamples = [];

function lookupWord(word) {
  const key = word.toLowerCase().trim();
  // 1. 精确匹配
  if (kajwebIndex.has(key)) {
    return { data: kajwebIndex.get(key), type: 'exact' };
  }
  // 2. 词干匹配
  for (const stem of simpleStems(key)) {
    if (stem === key) continue;
    const fullWord = kajwebStems.get(stem);
    if (fullWord && kajwebIndex.has(fullWord)) {
      return { data: kajwebIndex.get(fullWord), type: 'stem' };
    }
  }
  return null;
}

for (const relPath of SUPP_FILES) {
  const absPath = path.join(PROJECT_ROOT, relPath);
  const { header, footer, entries, segments } = parseSuppFile(absPath);

  let fileMissing = 0, fileExact = 0, fileStem = 0;

  for (const e of entries) {
    if (e.exampleEn && e.exampleEn.trim()) continue;  // 已有例句
    totalMissing++;
    fileMissing++;

    const result = lookupWord(e.word);
    if (!result) {
      totalUnmatched++;
      unmatched.push({ file: path.basename(relPath), word: e.word });
      continue;
    }

    const kajwebData = result.data;
    e.pos = kajwebData.pos || e.pos;
    e.exampleEn = kajwebData.exampleEn;
    e.exampleZh = kajwebData.exampleZh;

    if (result.type === 'exact') {
      totalExactMatched++;
      fileExact++;
    } else {
      totalStemMatched++;
      fileStem++;
    }

    if (matchedSamples.length < 15) {
      matchedSamples.push({
        file: path.basename(relPath),
        word: e.word,
        type: result.type,
        ex: kajwebData.exampleEn.slice(0, 60) + (kajwebData.exampleEn.length > 60 ? '...' : ''),
        zh: kajwebData.exampleZh.slice(0, 30),
      });
    }
  }

  console.log(`  ${relPath}: 缺 ${fileMissing}，精确匹配 ${fileExact}，词干匹配 ${fileStem}`);

  if (APPLY) {
    const newSrc = regenerateSuppFile(header, footer, entries, segments);
    fs.writeFileSync(absPath, newSrc);
  }
}

console.log();
console.log('=== 3. 补充结果汇总 ===');
console.log(`  总缺失：${totalMissing} 词`);
console.log(`  精确匹配：${totalExactMatched} 词`);
console.log(`  词干匹配：${totalStemMatched} 词`);
const totalMatched = totalExactMatched + totalStemMatched;
console.log(`  合计匹配：${totalMatched} 词 (${(totalMatched/totalMissing*100).toFixed(1)}%)`);
console.log(`  未匹配：${unmatched.length} 词`);

if (matchedSamples.length > 0) {
  console.log();
  console.log('=== 4. 匹配样本 ===');
  for (const s of matchedSamples) {
    console.log(`  [${s.type}] ${s.file} | ${s.word}`);
    console.log(`        EN: ${s.ex}`);
    console.log(`        ZH: ${s.zh}`);
  }
}

if (unmatched.length > 0) {
  console.log();
  console.log('=== 5. 未匹配词全列（按字母分类）===');
  // 简单分类：专有名词候选（首字母大写形式）、缩写（≤3 字符或全大写）、其他
  const proper = [], abbrev = [], realWords = [];
  const PROPER_SET = new Set(['david','charles','edward','alan','andrew','brian','chris','anne','bob',
    'christ','james','john','peter','michael','stephen','paul','mark','jones','smith','wilson','william',
    'thomson','jim','christmas','april','january','february','july','june','march','may','august',
    'september','october','november','december','britain','china','europe','european','american','america',
    'edinburgh','washington','york','wales','scotland','victoria','ireland','australia','london','paris',
    'berlin','birmingham','manchester','asia','africa','england','canada','india','africa','germany',
    'italy','russia','japan','korea','brazil','mexico','argentina','egypt','sweden','switzerland','norway',
    'denmark','finland','poland','greece','turkey','spain','portugal','netherlands','belgium','austria',
    'hungary','romania','bulgaria','croatia','serbia','ukraine','belarus','lithuania','latvia','estonia',
    'slovakia','slovenia','albania','moldova','macedonia','georgia','armenia','azerbaijan','kazakhstan',
    'uzbekistan','turkmenistan','kyrgyzstan','tajikistan','mongolia','nepal','bhutan','bangladesh',
    'pakistan','afghanistan','iran','iraq','syria','lebanon','jordan','israel','palestine','saudi',
    'yemen','oman','uae','qatar','bahrain','kuwait','cyprus','malta','iceland','ireland','luxembourg',
    'liechtenstein','monaco','sanmarino','vatican','andorra','montenegro','bosnia','kosovo',
  ]);
  for (const u of unmatched) {
    const lower = u.word.toLowerCase();
    if (PROPER_SET.has(lower) || (u.word.length <= 3 && /[A-Z]/.test(u.word))) {
      proper.push(u.word);
    } else if (u.word === u.word.toUpperCase() && u.word.length >= 2) {
      abbrev.push(u.word);
    } else {
      realWords.push(u.word);
    }
  }
  console.log(`  专有名词/缩写（${proper.length + abbrev.length} 个，可不补）:`);
  proper.slice(0, 30).forEach(w => console.log(`    ${w}`));
  abbrev.slice(0, 20).forEach(w => console.log(`    ${w}`));
  if (proper.length + abbrev.length > 50) console.log(`    ... (共 ${proper.length + abbrev.length} 个)`);
  console.log();
  console.log(`  真正常用词（${realWords.length} 个，需要继续找数据源或人工补）:`);
  realWords.slice(0, 40).forEach(w => console.log(`    ${w}`));
  if (realWords.length > 40) console.log(`    ... (共 ${realWords.length} 个)`);
}

console.log();
console.log(`=== 6. ${APPLY ? '✅ 已写入文件' : '💡 DRY-RUN，加 --apply 实际写入'} ===`);
