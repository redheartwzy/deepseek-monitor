/**
 * 轻量 lint：递归检查所有 JS 文件的语法（node --check，零额外依赖）。
 * 统一按 ESM 解析（CJS 的 require/module 只是合法标识符，不影响语法校验）。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'release', '.claude']);
const EXTS = new Set(['.js', '.mjs', '.cjs']);

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, acc);
    } else if (EXTS.has(path.extname(name))) {
      acc.push(full);
    }
  }
  return acc;
}

const files = walk(ROOT);
let failed = 0;

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const res = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: content,
    encoding: 'utf8',
    timeout: 15000
  });
  if (res.status !== 0) {
    failed++;
    const errMsg = (res.stderr || res.stdout || '').toString().trim().split('\n').slice(-3).join('\n');
    console.error(`✗ ${path.relative(ROOT, f).replace(/\\/g, '/')}\n  ${errMsg}`);
  }
}

if (failed) {
  console.error(`\n❌ Lint 失败：${failed} 个文件存在语法错误`);
  process.exit(1);
}
console.log(`✔ 语法检查通过（${files.length} 个 JS 文件）`);
