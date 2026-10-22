#!/usr/bin/env node
/**
 * p39：流水线 restart（后端）脚本两处加固。
 *
 * 背景一（2026-10-22 事故 · content-hub 漏配）：
 *   content-hub 加 JwtAuthGuard / InternalKeyGuard 后走平台流水线部署，但
 *   restart-backend 的干净重启**不经 ecosystem**，配置只来自服务自己的 .env。
 *   漏配 JWT_SECRET → 运营后台全部 401「登录凭证无效」；漏配
 *   CONTENT_HUB_SERVICE_KEY → InternalKeyGuard 空 key 全拒，mcp-gateway
 *   四模块 401。两者都表现为「部署成功但功能全挂」，排查成本极高。
 *   本迁移在 ① 依赖校验段补 content-hub 分支，缺失即 fail-fast 阻断发布。
 *
 * 背景二（2026-10-22 事故 · gateway 静态根漂移）：
 *   gateway 的 PUBLIC_ROOT = join(__dirname, '..', '..', 'public')，而 dist 是
 *   软链到 runtimes/<版本>/dist，join 会把 dist 也消掉 → 实际服务
 *   runtimes/<版本>/public（构建快照）。平台流水线把模块产物投递到
 *   servers/gateway/public，两份漂移 → /static/modules 全 404 → admin 白屏。
 *   且 .env 里配 STATIC_PUBLIC_ROOT **不生效**：该常量在 Node require 链
 *   加载时求值，早于 ConfigModule 读 .env（2026-10-22 实测验证）。
 *   本迁移在 ④ 干净重启段按模块透传 STATIC_PUBLIC_ROOT 进程环境变量
 *   （gateway 专属，未配置时回落 servers/gateway/public，与 remote-delivery
 *   的投递落点一致）。
 *
 * 幂等：两处改动各有独立标记（p39:content-hub-guard / p39:static-root），
 *       已存在即跳过；支持 ROLLBACK=1 按标记整体回退；DRY_RUN=1 只打印。
 * 安全：改完必须过 bash -n（该脚本是所有后端服务的 restart 执行体，
 *       语法错一次等于所有后端都发不上去）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, 'servers/deploy-console/.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const DRY_RUN = !!process.env.DRY_RUN;
const ROLLBACK = !!process.env.ROLLBACK;
const mysql = require(path.join(root, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));

// ── 改动 1：content-hub 依赖校验（插在 check_deps 的 mcp-gateway 分支之后）──
// 锚点说明：DB 模板与仓库副本缩进不同（DB 2 空格 / 仓库 4 空格），
// 故用 includes 匹配分支名，再找其后最近的独立 ';;' 行，两种格式通吃。
const GUARD_BEGIN = '# ══ p39:content-hub-guard:begin ══';
const GUARD_END = '# ══ p39:content-hub-guard:end ══';
const GUARD_ANCHOR = 'mcp-gateway)';
const GUARD_BLOCK = [
  GUARD_BEGIN,
  '    content-hub)',
  '      [ -f "$ENV_FILE" ] || die "content-hub 缺少 .env（${ENV_FILE}）"',
  '      [ -n "$(env_get "$ENV_FILE" JWT_SECRET)" ] || die \\',
  '        "content-hub/.env 缺少 JWT_SECRET —— 运营后台（/api/content-admin/*）用户 JWT 校验全部失败，',
  '      页面表现为管理页 401「登录凭证无效」而 MCP 链路正常（极难定位）。',
  '      修复：从 .env.production 同源复制 JWT_SECRET 到 ${ENV_FILE} 后重启 content-hub"',
  '      local ch_key gw_finnews_key',
  '      ch_key="$(env_get "$ENV_FILE" CONTENT_HUB_SERVICE_KEY)"',
  '      [ -n "$ch_key" ] || die \\',
  '        "content-hub/.env 缺少 CONTENT_HUB_SERVICE_KEY —— InternalKeyGuard 空 key 全拒，',
  '      mcp-gateway 的 paper/finnews/wechat_mp/institution 四模块调用全部 401。',
  '      修复：在 ${ENV_FILE} 增加 CONTENT_HUB_SERVICE_KEY（与 gateway 的 FINNEWS_SERVICE_KEY 同值）"',
  '      gw_finnews_key="$(env_get "${RELEASE_DIR}/servers/gateway/.env" FINNEWS_SERVICE_KEY)"',
  '      if [ -n "$ch_key" ] && [ -n "$gw_finnews_key" ] && [ "$ch_key" != "$gw_finnews_key" ]; then',
  '        die "content-hub.CONTENT_HUB_SERVICE_KEY 与 gateway.FINNEWS_SERVICE_KEY 不一致 —— 服务间调用 401"',
  '      fi',
  '      ;;',
  GUARD_END,
  '',
].join('\n');

// ── 改动 2：gateway STATIC_PUBLIC_ROOT 透传（插在 env -i 干净重启块之前）──
const ROOT_BEGIN = '# ══ p39:static-root:begin ══';
const ROOT_END = '# ══ p39:static-root:end ══';
const ROOT_ANCHOR = 'env -i';
/** PORT 赋值之后追加透传段（行内插入，兼容 DB 单行式与仓库多行式两种 env -i 写法） */
const ROOT_INJECT_SNIPPET = ' ${EXTRA_ENV[@]+"${EXTRA_ENV[@]}"}';
const ROOT_BLOCK = [
  ROOT_BEGIN,
  '# gateway 静态根透传（p39）：',
  '# 为什么必须走进程环境而不是 .env：PUBLIC_ROOT 是 public-root.ts 的模块级常量，',
  '# 在 Node require 链加载时求值，早于 ConfigModule 读 .env —— .env 里配',
  '# STATIC_PUBLIC_ROOT 永远不生效（2026-10-22 实测：/static/modules 全 404，',
  '# admin 白屏；根因是 gateway 服务 runtime 快照、流水线投递 servers/public，两份漂移）。',
  '# 未配置时回落 servers/gateway/public（与 remote-delivery 的投递落点一致）。',
  'EXTRA_ENV=()',
  'if [ "$MODULE_KEY" = "gateway" ]; then',
  '  GW_STATIC_ROOT="$(env_get "$ENV_FILE" STATIC_PUBLIC_ROOT)"',
  '  [ -n "$GW_STATIC_ROOT" ] || GW_STATIC_ROOT="${RELEASE_DIR}/servers/gateway/public"',
  '  EXTRA_ENV+=("STATIC_PUBLIC_ROOT=$GW_STATIC_ROOT")',
  '  log "gateway 静态根：${GW_STATIC_ROOT}"',
  'fi',
  ROOT_END,
  '',
].join('\n');

/** 语法自检：改完的脚本必须先过 bash -n（与 p25 同口径） */
function assertBashSyntax(script, label) {
  const r = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${label} 语法检查未通过：\n${r.stderr || r.stdout}`);
  }
}

function applyGuard(script) {
  if (script.includes(GUARD_BEGIN)) return null;
  const lines = script.split('\n');
  const i = lines.findIndex((l) => l.includes(GUARD_ANCHOR));
  if (i < 0) throw new Error(`脚本里找不到校验分支锚点「${GUARD_ANCHOR}」，拒绝盲改`);
  // 找该分支结束的独立 ';;' 行（锚点行之后第一个）
  let j = i + 1;
  while (j < lines.length && lines[j].trim() !== ';;') j++;
  if (j >= lines.length) throw new Error('找不到 mcp-gateway 分支的结束符 ;;，拒绝盲改');
  lines.splice(j + 1, 0, GUARD_BLOCK);
  return lines.join('\n');
}

function applyStaticRoot(script) {
  if (script.includes(ROOT_BEGIN)) return null;
  const lines = script.split('\n');
  const i = lines.findIndex((l) => l.includes(ROOT_ANCHOR));
  if (i < 0) throw new Error(`脚本里找不到重启锚点「${ROOT_ANCHOR}」，拒绝盲改`);
  if (!lines[i].includes('PORT="${PORT:-}"')) {
    throw new Error('env -i 行里找不到 PORT="${PORT:-}"，拒绝盲改');
  }
  // ① PORT 之后行内追加透传段（DB 单行式 / 仓库多行式都命中）
  const portLiteral = 'PORT="${PORT:-}"';
  lines[i] = lines[i].replace(portLiteral, portLiteral + ROOT_INJECT_SNIPPET);
  // ② env -i 行之前插入 EXTRA_ENV 定义块
  lines.splice(i, 0, ROOT_BLOCK);
  return lines.join('\n');
}

function revertByMarkers(script, begin, end) {
  const lines = script.split('\n');
  const b = lines.findIndex((l) => l.includes(begin));
  const e = lines.findIndex((l) => l.includes(end));
  if (b < 0 || e < b) return script;
  lines.splice(b, e - b + 1);
  // 清掉 env -i 行里的透传段
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].includes(ROOT_INJECT_SNIPPET)) {
      lines[k] = lines[k].replace(ROOT_INJECT_SNIPPET, '');
    }
  }
  return lines.join('\n');
}

async function main() {
  const conn = await mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
  });

  const [rows] = await conn.query(
    "SELECT a.id, a.script, t.name task_name, s.pipeline_id tpl FROM deploy_pipeline_actions a " +
      'JOIN deploy_pipeline_tasks t ON t.id = a.task_id ' +
      'JOIN deploy_pipeline_steps s ON s.id = t.step_id ' +
      "WHERE a.script LIKE \"%restart（后端）%\" ORDER BY s.pipeline_id",
  );
  console.log(`扫描到 ${rows.length} 个后端 restart 动作${ROLLBACK ? '（回退模式）' : ''}`);

  let changed = 0;
  let skipped = 0;
  for (const r of rows) {
    let next = r.script;
    try {
      if (ROLLBACK) {
        next = revertByMarkers(next, GUARD_BEGIN, GUARD_END);
        next = revertByMarkers(next, ROOT_BEGIN, ROOT_END);
        if (next === r.script) {
          skipped++;
          console.log(`- ${r.tpl} / ${r.task_name}: 无 p39 标记，跳过`);
          continue;
        }
      } else {
        const g = applyGuard(next);
        if (g !== null) next = g;
        const s = applyStaticRoot(next);
        if (s !== null) next = s;
        if (next === r.script) {
          skipped++;
          console.log(`- ${r.tpl} / ${r.task_name}: 已加固，跳过`);
          continue;
        }
      }
      assertBashSyntax(next, `${r.tpl}/${r.task_name}`);
    } catch (err) {
      console.error(`✗ ${r.tpl} / ${r.task_name}: ${err.message}`);
      process.exitCode = 1;
      continue;
    }
    if (DRY_RUN) {
      console.log(`- ${r.tpl} / ${r.task_name}: [DRY_RUN] 将更新（语法已过）`);
      continue;
    }
    await conn.query('UPDATE deploy_pipeline_actions SET script = ? WHERE id = ?', [next, r.id]);
    changed++;
    console.log(`✓ ${r.tpl} / ${r.task_name}: ${ROLLBACK ? '已回退' : '已加固'}（语法已过）`);
  }

  await conn.end();
  console.log(`\n完成：更新 ${changed} 个，跳过 ${skipped} 个${DRY_RUN ? '（DRY_RUN 未落库）' : ''}`);
  if (process.exitCode) {
    console.error('存在失败项，请检查后重跑（幂等）');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('迁移失败：', e.message);
  process.exit(1);
});
