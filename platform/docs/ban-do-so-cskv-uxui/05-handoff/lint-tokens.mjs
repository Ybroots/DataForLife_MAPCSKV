#!/usr/bin/env node
// Kiểm tra "100% theo design system": không có mã màu HEX/rgb(a) hoặc cỡ chữ px nằm ngoài token.
// Dùng:  node lint-tokens.mjs [thư-mục-gốc-gói]   (mặc định: thư mục cha của file này)
// Thoát mã 1 nếu có vi phạm — có thể gắn vào CI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const EXEMPT_FILES = new Set(['tokens.css', 'tokens.json', 'contrast-report.json']); // nơi định nghĩa token
const results = [];
let scanned = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'png', 'diagrams'].includes(e.name)) walk(p); continue; }
    if (!/\.(css|html|js)$/.test(e.name) || EXEMPT_FILES.has(e.name)) continue;
    scan(p);
  }
}

// Bỏ các khối được miễn: lớp .wf (phác thảo xám, mô phỏng giấy) và comment.
const blank = (m) => m.replace(/[^\n]/g, ' ');
function strip(src) {
  return src
    .replace(/\/\*\s*wf:start\s*\*\/[\s\S]*?\/\*\s*wf:end\s*\*\//g, blank) // khối được miễn
    .replace(/\/\*[\s\S]*?\*\//g, blank); // comment
}
// Với HTML chỉ kiểm tra phần STYLE (khối <style> và thuộc tính style="…"), không kiểm tra chữ hiển thị
// (tài liệu được phép in mã HEX làm nhãn).
function styleOnly(src) {
  const keep = [];
  src.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (m, css, off) => { keep.push([off + m.indexOf(css), css]); return m; });
  src.replace(/\sstyle="([^"]*)"/g, (m, css, off) => { keep.push([off + m.indexOf(css), css]); return m; });
  const out = src.replace(/[^\n]/g, ' ').split('');
  for (const [off, css] of keep) for (let i = 0; i < css.length; i++) out[off + i] = css[i];
  return out.join('');
}

function scan(file) {
  scanned++;
  if (file.endsWith('.js')) return scanJs(file);
  const rel = path.relative(root, file);
  const isHtml = file.endsWith('.html');
  let src = strip(fs.readFileSync(file, 'utf8'));
  if (isHtml) src = styleOnly(src);
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // 1) màu cố định
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g)) {
      results.push({ rel, line: i + 1, kind: 'màu HEX', text: m[0] });
    }
    for (const m of line.matchAll(/\brgba?\([^)]*\)/g)) results.push({ rel, line: i + 1, kind: 'màu rgb(a)', text: m[0] });
    // 2) cỡ chữ cố định
    for (const m of line.matchAll(/font-size\s*:\s*([^;}"]+)/g)) {
      if (!/var\(--fs-/.test(m[1])) results.push({ rel, line: i + 1, kind: 'font-size', text: m[0].trim() });
    }
    // 3) font-family rời
    for (const m of line.matchAll(/font-family\s*:\s*([^;}"]+)/g)) {
      if (!/var\(--font-/.test(m[1]) && !/inherit/.test(m[1])) results.push({ rel, line: i + 1, kind: 'font-family', text: m[0].trim() });
    }
  });
}

// JS: chỉ bắt chỗ gán màu/cỡ chữ trực tiếp (bỏ qua chữ mô tả quy tắc).
function scanJs(file) {
  const rel = path.relative(root, file);
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/(?:color|background(?:-color)?|border(?:-color)?|fill|stroke)\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) results.push({ rel, line: i + 1, kind: 'màu trong JS', text: m[0] });
    for (const m of line.matchAll(/font-size\s*:\s*([^;}"'`]+)/g)) if (!/var\(--fs-/.test(m[1])) results.push({ rel, line: i + 1, kind: 'font-size trong JS', text: m[0].trim() });
  });
}

walk(root);
const byKind = {};
for (const r of results) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
console.log(`Đã quét ${scanned} tệp (.css/.html) trong ${root}`);
if (!results.length) { console.log('✓ Không có màu/cỡ chữ/font nào nằm ngoài token.'); process.exit(0); }
for (const r of results.slice(0, 200)) console.log(`✗ ${r.rel}:${r.line}  [${r.kind}]  ${r.text}`);
console.log(`\nTổng: ${results.length} vi phạm`, byKind);
process.exit(1);
