#!/usr/bin/env node
/**
 * history-secret-scan — git 全历史敏感信息扫描（只读，不改动任何东西）
 *
 * 为什么需要：本仓库实际是 PUBLIC（2026-09-29 实测 `gh repo view` → visibility: PUBLIC）。
 * **清理 HEAD 不等于清理泄露**：旧 commit 的 blob 仍可被 `git show <sha>` 读到，
 * 里面躺着真实的服务器 IP、拓扑表、以及曾经提交过的本机/云库口令。
 * 本脚本用于「到底还留了多少、要不要做历史重写」的量化依据。
 *
 * 用法：
 *   node scripts/history-secret-scan.mjs [--json]
 *
 * 输出：按规则统计「命中行数 / 涉及文件数 / 涉及提交数」（不输出原文，避免二次泄露）。
 */
import { spawn } from 'node:child_process';

/** 服务器真实 IP（清理前仓库里长期硬编码的三个地址） */
const IPS = ['203.0.113.10', '198.51.100.20', '192.0.2.30'];

/** 规则表：只看「新增行」，刻意跳过占位值（<...> / process.env / your_* / test / example） */
const RULES = [
  { name: 'IP', rx: new RegExp(IPS.map((s) => s.replace(/\./g, '\\.')).join('|')) },
  {
    name: '口令赋值',
    rx: /(password|passwd|pwd|secret|mysql_password|db_password|apikey|api_key|token)\s*[:=]\s*["']?(?!<|\$\{|process\.env|YOUR|your|test|TEST|example|EXAMPLE|change_me)[^\s"'$#]{6,}/i,
  },
  { name: '私钥PEM', rx: /BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY/ },
  { name: '32位hex', rx: /\b[0-9a-f]{32}\b/ },
];

const stat = () => ({ lines: 0, files: new Set(), commits: new Set() });
const res = Object.fromEntries(RULES.map((r) => [r.name, stat()]));

const git = spawn('git', ['log', '--all', '--pretty=format:__C__%h', '-p', '--unified=0'],
  { stdio: ['ignore', 'pipe', 'ignore'] });

let curCommit = '?';
let curFile = '?';
git.stdout.setEncoding('utf8');
let buf = '';
git.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    handle(line);
  }
});
git.on('close', () => {
  if (buf.trim()) handle(buf.trim());
  report();
});

function handle(line) {
  if (line.startsWith('__C__')) { curCommit = line.slice(5); return; }
  if (line.startsWith('+++ ') || line.startsWith('--- ')) {
    const f = line.slice(4).trim();
    if (f.startsWith('b/')) curFile = f.slice(2);
    return;
  }
  if (!line.startsWith('+')) return;
  const body = line.slice(1);
  for (const r of RULES) {
    if (r.rx.test(body)) {
      const s = res[r.name];
      s.lines += 1;
      s.files.add(curFile);
      s.commits.add(curCommit);
    }
  }
}

function report() {
  const rows = RULES.map((r) => {
    const s = res[r.name];
    return { rule: r.name, lines: s.lines, files: s.files.size, commits: s.commits.size };
  });
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ scannedAt: new Date().toISOString(), rows }, null, 2) + '\n');
    return;
  }
  const w = (s, n) => String(s).padEnd(n, ' ');
  process.stdout.write('\n=== git 全历史敏感信息扫描（只读）===\n');
  for (const r of rows) {
    process.stdout.write(`  ${w(r.rule, 10)} 命中行数 ${String(r.lines).padStart(4)} | 涉及文件 ${String(r.files).padStart(3)} | 涉及提交 ${String(r.commits).padStart(3)}\n`);
  }
  process.stdout.write('\n说明：以上为历史快照。HEAD 已清理干净；历史遗留需 git filter-repo 重写才能抹除。\n');
}
