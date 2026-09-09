/**
 * self-knowledge corpgen —— 把 web_system 工程自身梳理成知识语料（RAG 自举真实数据源）
 *
 * 只读扫描工作区，生成三份模块化 markdown 知识条目到 scripts/self-knowledge/out/：
 *   - architecture 服务/路由/表/部署结构
 *   - agent-platform Agent 平台玩法（本演进能力与使用方式）
 *   - dev-guide UI 规范/微前端部署/agent-kit 契约/评测口径
 *
 * 用法：node scripts/self-knowledge/corpgen.mjs [outDir?]
 * 输出 manifest.json 供 load 阶段按集合入库。
 */
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(__dirname, 'out');

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.codebuddy', 'generated-images', 'uploads', 'public', '.next', '.turbo', 'coverage', 'scripts/self-knowledge']);
const MAX_LINES = 400;

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}
async function walk(dir, base = dir, acc = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, base, acc);
    else acc.push(path.relative(base, p));
  }
  return acc;
}
async function readIf(p) {
  try { return await readFile(p, 'utf8'); } catch { return ''; }
}
async function readJson(p) {
  const raw = await readIf(p);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function sliceLines(s, n = MAX_LINES) {
  const lines = s.split('\n');
  return lines.length > n ? lines.slice(0, n).join('\n') + '\n... (截断)' : s;
}
function bullet(items, cap = 120) {
  return items.slice(0, cap).map((i) => `- ${i}`).join('\n');
}

/** 收集服务器信息：package desc / main 默认端口 / controller 路由表 */
async function collectServices() {
  const out = [];
  const svcDir = path.join(ROOT, 'servers');
  const svcNames = await walk(svcDir, svcDir).then((f) =>
    [...new Set(f.map((x) => x.split('/')[0]))].sort(),
  );
  for (const name of svcNames) {
    const dir = path.join(svcDir, name);
    if (!(await exists(path.join(dir, 'src')))) continue;
    const pkg = await readJson(path.join(dir, 'package.json'));
    const main = await readIf(path.join(dir, 'src/main.ts'));
    const portMatch =
      main.match(/PORT\s*\|\|\s*(\d+)/) || main.match(/process\.env\.PORT\s*\|\|\s*(\d+)/) || main.match(/listen\((\d+)\)/);
    const env = await readIf(path.join(dir, '.env.example'));
    const envKeys = env
      .split('\n')
      .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l.trim()))
      .map((l) => l.trim().split('=')[0]);
    // controller 路由
    const srcFiles = await walk(path.join(dir, 'src'), path.join(dir, 'src'));
    const ctrl = srcFiles.filter((f) => f.endsWith('.controller.ts'));
    const routes = [];
    for (const f of ctrl) {
      const code = await readIf(path.join(dir, 'src', f));
      const pre = code.match(/@Controller\(['"]([^'"]+)/);
      for (const m of code.matchAll(/@(Get|Post|Put|Delete|Patch|All)\(['"]([^'"]*)/g)) {
        routes.push(`${pre?.[1] ?? ''} ${m[1]} ${m[2] || '/'}`.trim());
      }
    }
    const entityFiles = srcFiles.filter((f) => f.endsWith('.entity.ts'));
    const tables = [];
    for (const f of entityFiles) {
      const code = await readIf(path.join(dir, 'src', f));
      const t = code.match(/@Entity\(['"]([^'"]+)/);
      if (t) tables.push(t[1]);
    }
    out.push({
      name,
      desc: pkg?.description ?? '',
      port: portMatch ? Number(portMatch[1]) : null,
      envKeys: envKeys.slice(0, 40),
      tables: [...new Set(tables)],
      routeCount: routes.length,
      routes: routes.slice(0, 80),
      controllerFiles: ctrl.length,
    });
  }
  return out;
}

async function collectGateway() {
  const file = path.join(ROOT, 'servers/gateway/src/proxy/proxy.controller.ts');
  const code = await readIf(file);
  const routes = [...code.matchAll(/@All\(['"]([^'"]+)/g)].map((m) => m[1]).slice(0, 100);
  const targets = [...code.matchAll(/代理.*?\(([^)]*?)\s*→\s*([^)]*?)\)/g)].map((m) => m[0]).slice(0, 40);
  return { routes, targets };
}

async function collectMCP() {
  const svc = await readIf(path.join(ROOT, 'servers/mcp-gateway/src/mcp/mcp.service.ts'));
  const toolBlocks = [...svc.matchAll(/(\w+_HTTP_TOOLS)\s*:\s*Array[\s\S]{0,80}?name:\s*'([^']+)'/g)].map((m) => m[1]);
  const seedKeys = [...svc.matchAll(/code_key:\s*'([^']+)'/g)].map((m) => m[1]);
  const names = [...svc.matchAll(/name:\s*'([a-z_]+)',\s*\n\s*description:/g)].map((m) => m[1]);
  return { blocks: [...new Set(toolBlocks)], seedKeys: [...new Set(seedKeys)], toolNames: [...new Set(names)].slice(0, 80) };
}

async function collectAdmin() {
  const router = await readIf(path.join(ROOT, 'apps/admin/src/router/index.ts'));
  const pages = [];
  for (const m of router.matchAll(/path:\s*'([^']+)'[\s\S]*?component:\s*\(\) => import\('([^']+)'\)[\s\S]*?meta:\s*\{[^}]*?permission:\s*'([^']+)'/g)) {
    pages.push(`${m[1]} | ${m[2].split('/').pop()} | ${m[3]}`);
  }
  return pages.slice(0, 80);
}

async function collectPermissions() {
  const t = await readIf(path.join(ROOT, 'packages/types/src/index.ts'));
  const codes = [...t.matchAll(/['"]([a-z]+:[a-z_]+)['"]\s*:/g)].map((m) => m[1]).slice(0, 120);
  return [...new Set(codes)];
}

async function collectPackages() {
  const dir = path.join(ROOT, 'packages');
  const names = await walk(dir, dir).then((f) => [...new Set(f.map((x) => x.split('/')[0]))].sort());
  const out = [];
  for (const n of names) {
    if (!(await exists(path.join(dir, n, 'src')))) continue;
    const pkg = await readJson(path.join(dir, n, 'package.json'));
    out.push(`${n} — ${pkg?.description ?? ''}`);
  }
  return out;
}

async function collectSpecs() {
  const dir = path.join(ROOT, 'specs/agent-platform-evolution');
  const files = (await walk(dir, dir)).sort();
  return files.map((f) => `- ${f}`);
}

async function buildMarkdowns(services, gateway, mcp, admin, perms, pkgs, specs) {
  // 1) 架构
  const aLines = [];
  aLines.push('# web_system 工程架构总览', '', '> 自动生成：服务器/路由/表/代理/微前端。来源为源码静态扫描。', '');
  aLines.push('## 服务清单（servers/*）', '');
  for (const s of services) {
    aLines.push(`- **${s.name}** ${s.port ? `:${s.port}` : ''} — ${s.desc || '(无描述)'}`);
  }
  aLines.push('', '### 数据库表（@Entity 表名）', '');
  for (const s of services) {
    if (s.tables.length) aLines.push(`- ${s.name}: ${s.tables.join(', ')}`);
  }
  aLines.push('', '### 服务内 Controller 路由（前 80 条/服务）', '');
  for (const s of services) {
    if (!s.routes.length) continue;
    aLines.push(`#### ${s.name}`, '', bullet(s.routes));
  }
  aLines.push('', '## gateway 代理路由（/api 前缀）', '', bullet(gateway.routes.map((r) => `/api${r}`)));
  aLines.push('', '## 共享包（packages/*）', '', bullet(pkgs));
  aLines.push('', '## 端口与部署登记', '', '- deploy-local.sh BACKENDS 与 ecosystem.config.js 为部署事实源；health-check.sh SERVICES 为巡检清单。');
  aLines.push('', '## 前端微前端（apps/admin）', '', `- 路由与权限：${admin.length} 条页面路由`, bullet(admin.map((p) => p.replace(/\|/g, ' /'))));

  // 2) Agent 平台玩法
  const bLines = [];
  bLines.push('# Agent 平台玩法（agent-core / ai-agent / ai-service / mcp-gateway / knowledge）', '', '> 自动生成 + specs/agent-platform-evolution 指引。', '');
  bLines.push('## 核心原则', '', '- DB 是 Agent 定义的唯一事实源（代码 *.agent.ts 已废弃，seed 只补录缺失）。');
  bLines.push('- capabilities 三类引用：tool(代码注册) / mcp(module/tool) / skill；capability 可带 config（timeout/longRunning/requiresConfirm/collectionId）。');
  bLines.push('- MCP 工具 = mcp-gateway 声明式 seed（代码常量 → mcp_modules/mcp_tools），模块级启停，运行时 mcp-core 转发。');
  bLines.push('- 知识集合授权（决策 7=C）：集合不设白名单，agent 定义 capabilities 里 `{type:mcp,ref:knowledge/<tool>,config:{collectionId}}` 显式绑定即授权。');
  bLines.push('- 观测/成本：run 落 ai-service（agent_runs 含 usage/cost/agentVersion）+ run_metrics 日聚合 + model_pricing 单价。');
  bLines.push('', '## MCP 模块与工具', '', `- seed 模块 code_key: ${mcp.seedKeys.join(', ')}`, '', bullet(mcp.toolNames.map((n) => `\`${n}\``)));
  bLines.push('', '## 权限点清单（packages/types）', '', bullet(perms.map((p) => `\`${p}\``)));
  bLines.push('', '## 本演进规格（specs/agent-platform-evolution）', '', ...specs);
  bLines.push('', '## Admin 页面（路由/权限）', '', bullet(admin));

  // 3) 研发指南
  const cLines = [];
  cLines.push('# web_system 研发指南（UI / 部署 / 契约 / 评测）', '', '> 自动生成 + 约定索引。', '');
  const ui = await readIf(path.join(ROOT, 'docs/ui/README.md'));
  if (ui) cLines.push('', '## UI 规范地图（docs/ui）', '', sliceLines(ui, 40));
  const tokens = await readIf(path.join(ROOT, 'packages/ui/src/tokens.css'));
  if (tokens) {
    const vars = [...new Set([...tokens.matchAll(/--ws-[\w-]+/g)].map((m) => m[0]))];
    cLines.push('', '## 设计 Token（--ws-*）', '', bullet(vars, 80));
  }
  cLines.push('', '## admin 微前端交付铁律', '', '- 改完 admin 须走「构建 → 拷贝 gateway static/modules/admin/<hash> → 更新 web_system_deploy 版本表 → 验证 __manifest__」四步，否则浏览器仍加载旧产物。');
  cLines.push('', '## 数字人/Agent 契约（.codebuddy/agent-kit）', '', '- 产物链：intent → spec(requirements/design/tasks) → execute → 验收复盘；版本化产物必须落盘不只在对话中。');
  cLines.push('', '## 评测口径', '', '- Agent 平台 eval：程序化断言 + LLM-as-judge rubric（publish 前 smoke 门禁，Ragas 三指标用于 RAG 检索）。', '- 引擎侧遥测对齐 OTel GenAI SemConv（不引 SDK，schema 对齐），TelemetryPort 可换 OTLP 导出。');
  cLines.push('', '## 后端服务关键环境变量（.env.example 键）', '');
  for (const s of services) {
    if (s.envKeys.length) cLines.push(`- ${s.name}: ${s.envKeys.join(', ')}`);
  }

  return {
    'architecture': aLines.join('\n'),
    'agent-platform': bLines.join('\n'),
    'dev-guide': cLines.join('\n'),
  };
}

async function main() {
  const services = await collectServices();
  const gateway = await collectGateway();
  const mcp = await collectMCP();
  const admin = await collectAdmin();
  const perms = await collectPermissions();
  const pkgs = await collectPackages();
  const specs = await collectSpecs();
  const docs = await buildMarkdowns(services, gateway, mcp, admin, perms, pkgs, specs);

  await mkdir(OUT, { recursive: true });
  const manifest = {};
  for (const [key, text] of Object.entries(docs)) {
    const file = path.join(OUT, `${key}.md`);
    await writeFile(file, text, 'utf8');
    manifest[key] = { file, chars: text.length, lines: text.split('\n').length };
  }
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('GEN_OK', JSON.stringify(manifest, null, 2));
}

main().catch((e) => {
  console.error('GEN_FAIL', e);
  process.exit(1);
});
