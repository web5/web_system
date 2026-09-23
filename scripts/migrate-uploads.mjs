#!/usr/bin/env node
/**
 * migrate-uploads.mjs — 历史上传文件迁移到统一存储根（A5）
 *
 * 依据：`specs/backend-consolidation/design.md` 任务表 A5
 *       「`scripts/migrate-uploads.mjs`（仅 user-service 头像等用户上传）+ 灰度验证清单」
 *
 * 为什么要它：A3/A4 之后
 *   - 上传的**唯一写入点**是 upload-service，文件落在 `system_configs['storage.upload_dir']`
 *     指向的统一根（权威值由 system-service `/internal/storage/path` 给出）；
 *   - 读取走 gateway 的 `/api/uploads/*` → upload-service。
 *   而 user-service 时期的历史文件仍在 `servers/user-service/uploads/<category>/…`，
 *   不在统一根下 → 切完路由就会被 404（dev 上 avatars 没有兜底，正是 A5 要覆盖的场景）。
 *
 * 做什么：
 *   1. 把源目录按 **category（子目录名）** 拷到 `<统一根>/<category>/<file>`
 *   2. 生成映射报告（旧相对路径 → 新 URL），可选更新 `users.avatar` 等 DB 引用
 *   3. 打印可执行的**灰度验证清单**（迁移前后如何对账）
 *
 * 安全设计（默认零副作用）：
 *   - **默认 DRY_RUN**：只扫描与报告，不落盘、不改库。真正执行要显式 `--apply`
 *   - **不删源**：只有再显式 `--prune` 才删（且要求上一次 `--apply` 的校验结果通过）
 *   - **幂等**：目标已存在且 size（或 md5）一致即跳过
 *   - **统一根取权威值**：先调 system-service `/internal/storage/path`（`x-internal-key`），
 *     失败则退回 `--dst`；两者都没有 → 报错退出（绝不猜目录）
 *
 * 用法：
 *   DRY_RUN（默认）  node scripts/migrate-uploads.mjs
 *   指定源            node scripts/migrate-uploads.mjs --src ../web_system_release/servers/user-service/uploads
 *   指定目标（覆盖）  node scripts/migrate-uploads.mjs --dst ~/web_system/uploads
 *   真正执行          node scripts/migrate-uploads.mjs --apply
 *   更新 DB 引用      node scripts/migrate-uploads.mjs --apply --update-db
 *   严格比对内容      node scripts/migrate-uploads.mjs --apply --hash
 *   删除源文件        node scripts/migrate-uploads.mjs --apply --prune      # 仅在校验通过后
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mysql = require(path.join(process.cwd(), 'node_modules/.pnpm/node_modules/mysql2/promise.js'));

/** 解析参数 */
function parseArgs(argv) {
  const out = { src: null, dst: null, apply: false, prune: false, hash: false, updateDb: false, report: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--prune') out.prune = true;
    else if (a === '--hash') out.hash = true;
    else if (a === '--update-db') out.updateDb = true;
    else if (a === '--src') out.src = argv[++i];
    else if (a === '--dst') out.dst = argv[++i];
    else if (a === '--report') out.report = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const ROOT = path.resolve(process.cwd());
const DEFAULT_SRC = path.join(ROOT, 'servers', 'user-service', 'uploads');
/** 源目录里被视为 category 的一级子目录；空表示"任意一级子目录" */
const CATEGORIES = (process.env.CATEGORIES || '').split(',').map((s) => s.trim()).filter(Boolean);

function readEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

/**
 * 统一存储根的**权威值**：system-service `/internal/storage/path`。
 * 拿不到就用 --dst；都没有则退出（不猜目录 —— 猜错等于把文件搬到没人读的地方）。
 */
async function resolveStorageRoot() {
  if (args.dst) return { root: path.resolve(args.dst), source: '--dst' };
  const env = readEnvFile(path.join(ROOT, 'servers', 'deploy-console', '.env'));
  const sysEnv = readEnvFile(path.join(ROOT, 'servers', 'system-service', '.env'));
  const base = process.env.SYSTEM_SERVICE_URL || sysEnv.SYSTEM_SERVICE_URL || 'http://127.0.0.1:6004';
  const key = process.env.INTERNAL_API_KEY || env.INTERNAL_API_KEY || sysEnv.INTERNAL_API_KEY;
  if (!key) {
    throw new Error(
      '无法确定统一存储根：既没有 --dst，也取不到 INTERNAL_API_KEY（读 system-service /.env）。\n' +
        '  解决：显式传 --dst <统一根>（page/接口里显示的那条 storage.upload_dir），或先配好内部密钥。',
    );
  }
  const res = await fetch(`${base.replace(/\/+$/, '')}/internal/storage/path`, {
    headers: { 'x-internal-key': key },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`读取 /internal/storage/path 失败：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  const root = body?.data?.path;
  if (!root) throw new Error(`/internal/storage/path 返回缺少 data.path：${JSON.stringify(body).slice(0, 200)}`);
  return { root, source: `system_configs（${body.data.source || 'unknown'}）` };
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function md5(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

async function main() {
  const src = path.resolve(args.src || DEFAULT_SRC);
  if (!fs.existsSync(src)) {
    console.error(`源目录不存在：${src}\n  （历史上传位于 <仓库>/servers/user-service/uploads；可用 --src 指定）`);
    process.exit(2);
  }

  const { root, source } = await resolveStorageRoot();
  console.log(`源目录   : ${src}`);
  console.log(`统一根   : ${root}（来源 ${source}）`);
  console.log(`模式     : ${args.apply ? '执行（--apply）' : '预演（DRY_RUN，不落盘不改库）'}${args.prune ? ' + 删除源（--prune）' : ''}`);
  console.log(`比对方式 : ${args.hash ? 'md5' : 'size'}${args.updateDb ? ' + 更新 DB 引用' : ''}`);
  console.log('');

  const files = walk(src);
  const plan = [];
  for (const f of files) {
    const rel = path.relative(src, f);
    const parts = rel.split(path.sep);
    // 相对路径的第一级 = category；多级时保留后续层级（历史目录可能再分子目录）
    const category = parts[0];
    if (CATEGORIES.length && !CATEGORIES.includes(category)) continue;
    plan.push({ src: f, rel, category, dst: path.join(root, rel) });
  }

  console.log(`扫描到文件：${files.length} 个；纳入迁移：${plan.length} 个`);
  const byCat = plan.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
  console.log(`分类分布  ：${Object.entries(byCat).map(([k, v]) => `${k}=${v}`).join('  ') || '（无）'}`);
  console.log('');

  const results = [];
  for (const p of plan) {
    const sStat = fs.statSync(p.src);
    let action = 'copy';
    if (fs.existsSync(p.dst)) {
      const dStat = fs.statSync(p.dst);
      const same = args.hash ? md5(p.src) === md5(p.dst) : dStat.size === sStat.size;
      action = same ? 'skip(已存在且一致)' : 'conflict(目标存在但内容不同)';
    }
    const item = {
      category: p.category,
      from: path.relative(ROOT, p.src),
      to: p.dst,
      url: `/api/uploads/${p.rel.split(path.sep).join('/')}`,
      bytes: sStat.size,
      action,
    };
    results.push(item);

    if (args.apply && (action === 'copy' || (action.startsWith('conflict') && process.env.OVERWRITE === '1'))) {
      fs.mkdirSync(path.dirname(p.dst), { recursive: true });
      fs.copyFileSync(p.src, p.dst);
      item.action = `copied${action.startsWith('conflict') ? '(覆盖)' : ''}`;
    }
  }

  const counts = results.reduce((m, r) => ((m[r.action] = (m[r.action] || 0) + 1), m), {});
  console.log('结果统计：');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(28)} ${v}`);

  const reportPath = args.report || path.join(ROOT, `uploads-migration-report-${Date.now()}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ src, storageRoot: root, rootSource: source, mode: args.apply ? 'apply' : 'dry-run', items: results }, null, 2),
    { mode: 0o600 },
  );
  console.log(`\n映射报告：${reportPath}`);

  if (args.updateDb) {
    try {
      const env = readEnvFile(path.join(ROOT, 'servers', 'user-service', '.env'));
      const conn = await mysql.createConnection({
        host: env.DB_HOST || process.env.DB_HOST || '127.0.0.1',
        port: Number(env.DB_PORT || process.env.DB_PORT || 3306),
        user: env.DB_USERNAME || process.env.DB_USER || 'root',
        password: env.DB_PASSWORD || process.env.DB_PASS || '',
        database: env.DB_DATABASE || process.env.DB_DATABASE || 'web_system',
      });
      // 只更新"仍指向旧路径"的引用：/uploads/<category>/<file> → /api/uploads/<category>/<file>
      const [rows] = await conn.query("SELECT id, avatar FROM users WHERE avatar IS NOT NULL AND avatar <> ''");
      let changed = 0;
      for (const r of rows) {
        const next = String(r.avatar).replace(/(^|\/)(uploads)\//, '$1api/uploads/');
        if (next !== r.avatar) {
          if (args.apply) await conn.query('UPDATE users SET avatar=? WHERE id=?', [next, r.id]);
          changed += 1;
        }
      }
      console.log(`DB 引用（users.avatar）：共 ${rows.length} 条有值，需改写 ${changed} 条${args.apply ? '（已更新）' : '（预演）'}`);
      await conn.end();
    } catch (e) {
      console.warn(`更新 DB 引用失败（不阻断迁移）: ${e.message}`);
    }
  }

  if (args.prune) {
    if (!args.apply) {
      console.error('\n--prune 只在 --apply 时有意义（先执行并校验，再单独删源）');
      process.exit(2);
    }
    const ok = results.every((r) => r.action !== 'conflict(目标存在但内容不同)');
    if (!ok) {
      console.error('\n存在"目标内容不同"的项 → 不删源，请先人工对账（见映射报告）');
      process.exit(3);
    }
    for (const p of plan) fs.rmSync(p.src, { force: true });
    console.log(`\n已删除源文件 ${plan.length} 个（目录保留，确认无残留后可手工清理 ${src}）`);
  }

  console.log(`
──────── 灰度验证清单（A5，迁移后照做） ────────
1) 文件对账：源/目标文件数与字节数一致（看上面统计与映射报告）
2) 静态可达：curl -o /dev/null -w '%{http_code}' https://<域名>/api/uploads/<category>/<文件>  期望 200
3) DB 引用：抽查 users.avatar 已是 /api/uploads/... 形态（--update-db 才算改）
4) 页面实看：头像/上传的图能显示；上传一张新图，确认落到统一根（/internal/storage/path 那条）
5) 回滚：出问题就停在新路由 + 保留源目录（本脚本不删源，除非显式 --prune）
6) 观察一个发布周期后，再做 A7（删除 user-service 上传端点与 static serve）
`);
}

main().catch((e) => {
  console.error(`\n失败：${e.message}`);
  process.exit(1);
});
