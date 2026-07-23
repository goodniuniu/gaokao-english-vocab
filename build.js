#!/usr/bin/env node
/**
 * 轻量构建脚本 — 自动哈希缓存方案
 * ==================================================
 * 解决 CDN/GitHub Pages 缓存问题，无需 Vite/Webpack。
 *
 * 工作原理：
 *   1. 读取 index.html 中所有 ?v=DEV 引用
 *   2. 计算对应文件的内容哈希（8位 hex）
 *   3. 复制全部文件到 dist/，把 ?v=DEV 替换为真实哈希
 *
 * 效果：
 *   文件没改 → 哈希不变 → 命中缓存（快）
 *   文件改动 → 哈希变化 → 浏览器重新拉取（新）
 *
 * 用法：
 *   node build.js          # 构建到 dist/
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// 需要忽略的文件/目录（不发布到 GitHub Pages）
const IGNORE = ['dist', '.git', '.workbuddy', 'node_modules', 'worker', '.github', 'test',
  'build.js', '.gitignore', '.gitattributes', 'package.json', 'package-lock.json'];

// 判断文件是否应跳过发布
function shouldSkip(relPath) {
  if (IGNORE.some(ig => relPath === ig || relPath.startsWith(ig + '/'))) return true;
  // 根目录的 Markdown 文档（README/DEPLOY/营销文案/排障指南等）属于内部资料，不对外发布
  if (!relPath.includes('/') && relPath.endsWith('.md')) return true;
  return false;
}

// 计算文件内容的 8 位哈希
function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

// 递归收集所有文件
function collectFiles(dir, base) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(base, fullPath).replace(/\\/g, '/');

    if (shouldSkip(relPath)) continue;

    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, base));
    } else {
      results.push({ relPath, fullPath });
    }
  }
  return results;
}

// 递归复制目录
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ===== 主流程 =====
console.log('🔨 开始构建...\n');

// 1. 清空/创建 dist
if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true });
}
fs.mkdirSync(DIST, { recursive: true });

// 2. 复制所有文件到 dist
const allFiles = collectFiles(ROOT, ROOT);
for (const file of allFiles) {
  const destPath = path.join(DIST, file.relPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(file.fullPath, destPath);
}

// 3. 读取 dist/index.html，替换 ?v=DEV
const distHtmlPath = path.join(DIST, 'index.html');
let html = fs.readFileSync(distHtmlPath, 'utf-8');

// 匹配 src="xxx?v=DEV" 和 href="xxx?v=DEV"
const refRegex = /(?:src|href)="([^"]+?)\?v=DEV"/g;
let replaced = 0;

html = html.replace(refRegex, (match, filePath) => {
  // 如果路径以 ./ 或 / 开头，标准化处理
  const cleanPath = filePath.replace(/^\.?\//, '');
  const absPath = path.join(DIST, cleanPath);

  if (!fs.existsSync(absPath)) {
    console.warn(`  ⚠️  文件不存在: ${cleanPath}`);
    return match;
  }

  const hash = hashFile(absPath);
  replaced++;
  const tag = match.startsWith('src') ? 'src' : 'href';
  return `${tag}="${filePath}?v=${hash}"`;
});

fs.writeFileSync(distHtmlPath, html);

// 4. 输出结果
console.log(`✅ 构建完成！\n`);
console.log(`   输出目录: dist/`);
console.log(`   哈希替换: ${replaced} 个文件引用\n`);

// 展示替换结果
const showResult = html.match(/(?:src|href)="[^"]+\?v=[a-f0-9]{8}"/g);
if (showResult) {
  console.log('   哈希清单:');
  showResult.forEach(line => {
    console.log(`     ${line.replace(/"/g, '')}`);
  });
}
console.log('\n📌 部署方式: 将 dist/ 目录内容推送到 GitHub Pages 即可');
console.log('   如: npx gh-pages -d dist');
