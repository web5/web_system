#!/usr/bin/env node
/**
 * history-secret-scan — git 全历史敏感信息扫描（只读，不改动任何东西）
 *
 * 为什么需要：本仓库是 PUBLIC（`gh repo view web5/web_system` → visibility: PUBLIC）。
 * **清理 HEAD 不等于清理泄露**：旧 commit 的 blob 仍可被 `git show <sha>` 读到，
 * 里面躺着真实的服务器 IP、拓扑表、以及曾经提交过的本机/云库口令。
 * 本脚本用于回答两件事：① 现在还残留多少；② 历史重写之后是否真的清零。
 *
 * 用法：
 *   node scripts/history-secret-scan.mjs                    # 默认规则扫描全历史
 *   node scripts/history-secret-scan.mjs --json             # 机器可读输出
 *   node scripts/history-secret-scan.mjs --values ~/.secret-values.txt
 *   node scripts/history-secret-scan.mjs --allow  ~/.secret-allow.txt
 *
 *   --values <file>  每行一个**真实字符串**（IP / 口令 / 实例号），逐字比对。
 *                    用于「这三个口令到底还在不在历史里」这种精确核查 —— 比正则可靠得多。
 *   --allow  <file>  每行一个**免检字符串**（如设计上公开的微信 AppID、文档保留地址）。
 *
 * 输出：按规则统计「命中行数 / 涉及文件数 / 涉及提交数」（不输出原文，避免二次泄露）。
 *
 * ⚠️ 判读说明：正则规则偏保守，**必然有噪音**（`usage.completion_tokens` 变量、
 * `configService.get('DB_PASSWORD')` 取值代码、模板变量 `PWD={{...}}` 都会命中）。
 * 它适合回答「大概还剩多少」，不适合作为结论 ——
 * 真正的验收要用 `--values <file>` 逐字比对已知的真实口令/IP（its result = 0 才算干净）。
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : '';
};
const readLines = (p) =>
  p && existsSync(p)
    ? readFileSync(p, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
    : [];

/**
 * IPv4 分段取值判定：返回 true 表示该地址属于「文档/私有/本机」范围，不算泄露。
 * 这一层很重要 —— 2026-09-29 全历史重写时把所有真实 IP 换成了 RFC5737 文档保留地址
 * （203.0.113.x / 198.51.100.x / 192.0.2.x），若不做豁免，重写后扫描器会一直报几百行
 * 「命中」，让人误以为没清干净。
 */
const isBenignIp = (ip) => {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return true;
  const [a, b] = p;
  if (a === 0 || a === 127 || a >= 224) return true; // 本机 / 回环 / 组播保留
  if (['1.2.3.4', '3.4.5.6', '2.2.2.2', '255.255.255.255'].includes(ip)) return true; // 文档示例地址
  // 公共 DNS 常量不是凭证，留着只会淹没真正的问题
  if (['1.1.1.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '114.114.114.114'].includes(ip)) return true;
  if (a === 10) return true; // RFC1918 私有
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 私有
  if (a === 192 && b === 168) return true; // RFC1918 私有
  if (a === 169 && b === 254) return true; // link-local
  if (a === 203 && b === 0 && p[2] === 113) return true; // RFC5737 TEST-NET-1
  if (a === 198 && b === 51 && p[2] === 100) return true; // RFC5737 TEST-NET-2
  if (a === 192 && b === 0 && p[2] === 2) return true; // RFC5737 TEST-NET-3
  return false;
};

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

/** 规则表：只看「新增行」，刻意跳过占位值（<...> / ${...} / process.env / your_* / test / example） */
const RULES = [
  {
    name: '公网IP',
    // SVG path 里的一串数字常被误读成 IP（如 73.83.3.17），整行带有矢量路径特征时跳过
    test: (body) => {
      if (/viewBox|<path|\bd="[Mm]/.test(body)) return false;
      const m = body.match(IPV4);
      return !!m && m.some((ip) => !isBenignIp(ip));
    },
  },
  {
    name: '口令赋值',
    test: (body) =>
      /(password|passwd|pwd|secret|mysql_password|db_password|apikey|api_key|token)\s*[:=]\s*["']?(?!<|\$\{|process\.env|YOUR|your|test|TEST|example|EXAMPLE|change_me)[^\s"'$#]{6,}/i.test(
        body,
      ),
  },
  { name: '私钥PEM', test: (body) => /BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY/.test(body) },
  { name: '32位hex', test: (body) => /\b[0-9a-f]{32}\b/.test(body) },
];

const values = readLines(argOf('--values'));
const allow = readLines(argOf('--allow'));
const ruleNames = [...RULES.map((r) => r.name), ...(values.length ? ['名单口令'] : [])];

const stat = () => ({ lines: 0, files: new Set(), commits: new Set() });
const res = Object.fromEntries(ruleNames.map((n) => [n, stat()]));

const git = spawn(
  'git',
  ['log', '--all', '--pretty=format:__C__%h', '-p', '--unified=0'],
  { stdio: ['ignore', 'pipe', 'ignore'] },
);

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
  if (line.startsWith('__C__')) {
    curCommit = line.slice(5);
    return;
  }
  if (line.startsWith('+++ ') || line.startsWith('--- ')) {
    const f = line.slice(4).trim();
    if (f.startsWith('b/')) curFile = f.slice(2);
    return;
  }
  if (!line.startsWith('+')) return;
  let body = line.slice(1);
  // 免检清单：命中即整行跳过（用于设计上公开的标识符，如微信 AppID）
  for (const ok of allow) if (body.includes(ok)) return;
  const hit = (name) => {
    const s = res[name];
    s.lines += 1;
    s.files.add(curFile);
    s.commits.add(curCommit);
  };
  for (const r of RULES) if (r.test(body)) hit(r.name);
  for (const v of values) if (body.includes(v)) hit('名单口令');
}

function report() {
  const rows = ruleNames.map((rule) => {
    const s = res[rule];
    return { rule, lines: s.lines, files: s.files.size, commits: s.commits.size };
  });
  if (process.argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify({ scannedAt: new Date().toISOString(), rows }, null, 2) + '\n',
    );
    return;
  }
  const w = (s, n) => String(s).padEnd(n, ' ');
  process.stdout.write('\n=== git 全历史敏感信息扫描（只读）===\n');
  for (const r of rows) {
    process.stdout.write(
      `  ${w(r.rule, 10)} 命中行数 ${String(r.lines).padStart(4)} | 涉及文件 ${String(r.files).padStart(3)} | 涉及提交 ${String(r.commits).padStart(3)}\n`,
    );
  }
  const total = rows.reduce((a, r) => a + r.lines, 0);
  process.stdout.write(
    total === 0
      ? '\n结论：全历史 0 命中（已豁免 RFC1918 私有地址与 RFC5737 文档保留地址）。\n'
      : '\n说明：以上为历史快照。历史遗留需 git filter-repo 重写才能抹除；\n      用 --values <文件> 可对具体口令做逐字精确核查（比正则可靠）。\n',
  );
}
