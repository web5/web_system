/**
 * agent-core 导出对拍：README 声明 ↔ src/index.ts 实际导出。
 *
 * 起因（2026-10-10，`docs/api/contracts.md` §9 D7）：README 与源码注释长期写
 * `DeepseekClient`，而该类早已被 `TokenHubClient` 取代且不再导出 —— 文档漂移让
 * 「照文档写 import」直接编译失败。文档不会自己报错，所以给它装一个机检。
 *
 * 检查两件事：
 *   1. DRIFT —— README 里点名了、但 index.ts 没导出（照文档抄会踩空）
 *   2. MISSING —— index.ts 导出了、但 README「API 概览」表里没列（新增导出忘了同步）
 *
 * 运行：node scripts/check-agent-core-exports.mjs （仓库根目录执行）
 *       无输出 = 一致；有差异则打印并 exit 1。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG_DIR = path.join(ROOT, 'packages/agent-core');
const INDEX_FILE = path.join(PKG_DIR, 'src/index.ts');
const README_FILE = path.join(PKG_DIR, 'README.md');

/**
 * 反引号里的大写开头标识符，但明显不是本包导出符号的专有名词。
 * 加了新词才需要动这里；宁可漏报也不要误报（误报会让人关掉检查）。
 */
const NON_EXPORT_TERMS = new Set([
  'ReAct', 'OpenAI', 'MCP', 'SSE', 'JSON', 'OTel', 'TC3', 'MIT', 'Node',
  'TypeScript', 'WSA', 'Bing', 'DeepSeek', 'TokenHub', 'HTTP', 'API', 'CLI',
  'Deepseek', 'Hy3', 'Readme', 'README',
]);

/** 收集 index.ts 的实际导出名（递归展开 `export * from './x'`） */
function collectExports(file, seen = new Set(), depth = 0) {
  if (depth > 3 || seen.has(file)) return new Set();
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();

  // export { A, B as C } from '...' / export type { A } from '...'
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }

  // export * from './x' → 递归解析目标文件
  for (const m of src.matchAll(/export\s+\*\s+from\s*'([^']+)'/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const base = path.resolve(path.dirname(file), spec);
    const target = [base + '.ts', path.join(base, 'index.ts')].find((p) => fs.existsSync(p));
    if (!target) continue;
    for (const n of collectExports(target, seen, depth + 1)) names.add(n);
  }

  // 直接声明：export class/interface/type/const/function/enum/abstract class
  for (const m of src.matchAll(
    /export\s+(?:abstract\s+|declare\s+)?(?:class|interface|type|enum|const|function|let|var)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(m[1]);
  }
  return names;
}

/** 收集 README 里反引号包裹、大写开头的标识符 */
function collectReadmeSymbols() {
  const src = fs.readFileSync(README_FILE, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/`([^`\n]+)`/g)) {
    const token = m[1].trim();
    if (!/^[A-Z][A-Za-z0-9_$]*$/.test(token)) continue; // 只要纯标识符（排除路径/命令）
    if (NON_EXPORT_TERMS.has(token)) continue;
    names.add(token);
  }
  return names;
}

/** README「API 概览」表格里列出的符号（用于 MISSING 判定的分母） */
function collectApiTableSymbols() {
  const src = fs.readFileSync(README_FILE, 'utf8');
  const start = src.indexOf('## API 概览');
  if (start === -1) return null;
  const end = src.indexOf('\n## ', start + 1);
  const section = src.slice(start, end === -1 ? undefined : end);
  const names = new Set();
  for (const m of section.matchAll(/`([A-Z][A-Za-z0-9_$]*)`/g)) names.add(m[1]);
  return names;
}

if (!fs.existsSync(INDEX_FILE) || !fs.existsSync(README_FILE)) {
  console.error(`[check-agent-core-exports] 缺少文件：${INDEX_FILE} / ${README_FILE}`);
  process.exit(2);
}

const actual = collectExports(INDEX_FILE);
const documented = collectReadmeSymbols();
const apiTable = collectApiTableSymbols();

const errors = [];
const warnings = [];

// 1) DRIFT（error）：文档点了名、实际没导出 → 照文档 import 直接编译失败
for (const name of [...documented].sort()) {
  if (!actual.has(name)) errors.push(`README 写了 \`${name}\`，但 src/index.ts 未导出（照文档抄会踩空）`);
}

// 2) MISSING（warning）：实际导出了、README 全文没提 → 新增导出忘了同步文档
//    只做提醒不阻断：概览表本来就不追求全量，误报会让人关掉检查。
if (apiTable) {
  for (const name of [...actual].sort()) {
    if (!apiTable.has(name) && !documented.has(name)) {
      warnings.push(`src/index.ts 导出了 \`${name}\`，README「API 概览」未列`);
    }
  }
}

if (errors.length === 0) {
  console.log(
    `[check-agent-core-exports] OK — 导出 ${actual.size} 个，README 点名 ${documented.size} 个，无漂移` +
      (warnings.length ? `（${warnings.length} 条未列提示，见下方）` : ''),
  );
  if (process.env.VERBOSE === '1') {
    for (const w of warnings) console.log(`  - MISSING  ${w}`);
  }
  process.exit(0);
}

console.error(`[check-agent-core-exports] 发现 ${errors.length} 处文档漂移：`);
for (const e of errors) console.error(`  - DRIFT  ${e}`);
console.error('\n修法：改 README 对齐 src/index.ts 的真实导出（或补导出）。');
process.exit(1);
