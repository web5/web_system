#!/usr/bin/env node
/**
 * 新建 spec feature 骨架（SDD：从源头防止规格漂移）
 *
 *   node scripts/new-spec.mjs <feature-slug>              # 只建 requirements.md
 *   node scripts/new-spec.mjs <feature-slug> --design     # 连带 design.md 骨架
 *   node scripts/new-spec.mjs <feature-slug> --dry-run    # 只打印将创建什么
 *
 * 规范真源：~/AiWorkspace/20-私域资产/规格驱动开发SDD-SOP.md
 *   §1 目录结构 / §3 状态字段 / §4 requirements 模板 / §4.1 EARS 格式
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * SOP §7 的验收项里有一条：「新开 feature 时按 §1/§4 模板创建，无需人工提醒」。
 * 但在这之前，模板只存在于 SOP 正文里，没有任何可执行形态 —— 每个 agent / 人
 * 都得凭记忆抄 8 个章节名和状态行，抄出来各不相同。存量实测（2026-11-06，8 份
 * requirements.md）：SOP §4 八个章节全齐的只有 2 份，标题各写各的
 * （「需求辨证」「验证判据表」「使用场景」…）。
 *
 * 门禁（scripts/audit-specs.mjs）只能判「存量有没有违规」，判不了「新建时有没有
 * 按模板写」—— 因为人可以先建一个空文件再慢慢补，门禁看到的只是当下的样子。
 * 所以模板必须做成**可执行的生成器**，让正确形态成为最省力的路径。
 *
 * 设计约束：
 *   1. 骨架里的每个章节都留一句「写什么」的提示，不留下空白标题（空白标题会
 *      被当成「占位残留」，红线 R3 会拦）。
 *   2. 状态一律落 `需求编写中` / `方案设计中` —— 新文件不可能是「已实现」。
 *   3. 生成后自动跑一次门禁自检，产物不合规立刻报出来（脚手架自己也要被验证）。
 *   4. 目录已存在时拒绝执行（除非 --force），避免覆盖别人正在写的东西。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = path.join(ROOT, 'specs');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const slug = argv.find((a) => !a.startsWith('--'));
const DRY = flags.has('--dry-run');
const WITH_DESIGN = flags.has('--design');
const FORCE = flags.has('--force');

const today = new Date().toISOString().slice(0, 10);

function die(msg) {
  console.error(`\n🔴 ${msg}\n`);
  process.exit(1);
}

if (!slug) {
  die(
    '缺少 feature 名。\n' +
      '   用法：node scripts/new-spec.mjs <feature-slug> [--design] [--dry-run]\n' +
      '   例：  node scripts/new-spec.mjs invoice-export --design',
  );
}

// 目录名约定：kebab-case 全小写。SOP §2 只约束文件名，但目录名混用大小写/下划线
// 会让 `specs/<feature>/` 的引用在大小写敏感系统上直接断，所以这里从源头卡住。
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  die(
    `feature 名不合约定：${slug}\n` +
      '   要求：全小写 kebab-case，如 invoice-export（不要下划线 / 大写 / 空格）',
  );
}

const dir = path.join(SPECS, slug);
if (fs.existsSync(dir) && !FORCE) {
  die(
    `目录已存在：specs/${slug}\n` +
      '   它可能已有 spec 在写。确需在已有目录补骨架请加 --force（不会覆盖已存在文件）。',
  );
}

const requirements = `# 需求 spec · ${slug}

> 状态：需求编写中 ｜ ${today}
> 关联代码：<真实代码目录，如 servers/xxx 或 apps/xxx —— 不要写 specs/ 内部引用>
> 下游文档：design.md → <方案文档名>

## 0. 一句话背景

<这个 feature 解决什么问题。一句话；写不清说明还没想清楚，先别开工。>

## 1. 目标与非目标

| 编号 | 目标（本次要做） |
|---|---|
| G1 | <可观测的结果，不是「做一个模块」这类动作> |

| 编号 | 非目标（明确不做） |
|---|---|
| NG1 | <最容易被人顺手扩进来的那件事 —— 写清楚，免得后面反复讨论> |

## 2. 已确认前提

> 用户/业务方已经拍板的事实，跨会话不丢。被否决的方案也记一行，免得下个 agent 又提一遍。

| 编号 | 决策 | 日期 | 来源 |
|---|---|---|---|
| D1 | <决策内容> | ${today} | <谁定的> |

## 3. 角色与场景

| 角色 | 场景 | 期望 |
|---|---|---|
| <谁> | <在什么情况下> | <想达成什么> |

## 4. 术语表

| 术语 | 含义 |
|---|---|
| <本 feature 里会被反复用到的词> | <一句话定义> |

## 5. 功能需求（FR）+ 验收判据（EARS）

> 判据格式（SOP §4.1）：当〈触发条件〉时，系统应〈行为〉，使得〈可观测结果〉。

| 编号 | 需求 | 验收判据（EARS） |
|---|---|---|
| FR-1 | <功能描述> | 当〈触发〉时，系统应〈行为〉，使得〈可观测结果〉。 |

## 6. 边界与反例

> 明确不算做成的情形（B1..Bn）。这一节决定「验收时怎么吵」，务必写。

| 编号 | 边界 / 反例 | 期望行为 |
|---|---|---|
| B1 | 当〈异常/极端输入〉时 | 系统应〈拒绝/降级/报错〉，**不得**〈静默失败 / 写脏数据〉 |

## 7. 非功能需求（NFR）

| 维度 | 要求 |
|---|---|
| 性能 | <量化，如 P95 < 300ms> |
| 安全 | <鉴权 / 数据隔离要求> |
| 兼容 | <需要保持兼容的旧行为> |

## 8. 待确认项

| 编号 | 待确认 | 当前假设（未确认按此推进） |
|---|---|---|
| Q1 | <问题> | <假设 + 一旦被推翻要改哪里> |

## 变更日志

- ${today} 建立骨架（scripts/new-spec.mjs）
`;

const design = `# 设计方案 · ${slug}

> 状态：方案设计中 ｜ ${today}
> 上游：requirements.md（需求与验收判据的单一事实源，本文件不复述）

## 0. 结论先行

<一屏内说清：选了什么方案、为什么、不用什么。>

## 1. 方案对比

| 方案 | 做法 | 代价 | 结论 |
|---|---|---|---|
| A | <做法> | <代价> | <选/不选及理由> |

## 2. 数据与接口

<表结构 / 接口签名 / 关键字段。有 api-design.md 的从这里指过去，不要重复。>

## 3. 关键流程

<主链路 + 失败分支。图或编号步骤均可。>

## 4. 分期与任务拆解

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| P1 | <最小可验证闭环> | <怎么算完成> |

## 5. 验证判据

> 与 requirements.md 的 EARS 一一对应；编号对齐，便于验收时逐条勾。

| 编号 | 判据 | 验证方式 |
|---|---|---|
| V1 | <对应 FR-1 的可观测结果> | <单测 / 手工 / 命令> |

## 6. 风险与回滚

| 风险 | 触发条件 | 处置 |
|---|---|---|
| <风险> | <怎么发现> | <回滚/降级手段> |
`;

const plan = [
  [path.join(dir, 'requirements.md'), requirements],
  ...(WITH_DESIGN ? [[path.join(dir, 'design.md'), design]] : []),
];

if (DRY) {
  console.log(`[dry-run] 将创建 ${plan.length} 个文件：`);
  for (const [p] of plan) console.log(`  ${path.relative(ROOT, p)}`);
  process.exit(0);
}

fs.mkdirSync(dir, { recursive: true });
const created = [];
for (const [p, body] of plan) {
  if (fs.existsSync(p) && !FORCE) {
    console.log(`⏭  已存在，跳过：${path.relative(ROOT, p)}`);
    continue;
  }
  if (fs.existsSync(p) && FORCE) {
    console.log(`⏭  已存在，不覆盖（--force 也不盖）：${path.relative(ROOT, p)}`);
    continue;
  }
  fs.writeFileSync(p, body);
  created.push(path.relative(ROOT, p));
}

console.log(`✅ 已创建 ${created.length} 个文件：`);
for (const c of created) console.log(`   ${c}`);

// 自检：脚手架产物必须天然过门禁，否则这个脚本本身就是新的漂移源头
try {
  execFileSync(process.execPath, ['scripts/audit-specs.mjs'], { cwd: ROOT, stdio: 'pipe' });
  console.log('\n✅ 门禁自检通过（新骨架无新增违规）');
} catch (e) {
  console.error('\n🔴 门禁自检失败 —— 骨架本身不合规，请修 scripts/new-spec.mjs：');
  console.error(String(e.stdout ?? '') || String(e.message));
  process.exit(1);
}

// 索引同步：新 feature 必须进 specs/README.md，否则 specs:index:check 立刻判过期。
// 放在自检之后（先确认合规，再改生成物），失败也不静默 —— 否则索引会悄悄落后于目录。
try {
  execFileSync(process.execPath, ['scripts/gen-specs-index.mjs'], { cwd: ROOT, stdio: 'pipe' });
  console.log('✅ specs/README.md 已重建（新 feature 已入索引）');
} catch (e) {
  console.error('\n🔴 索引重建失败（feature 已创建，但索引未更新）：');
  console.error(String(e.stderr ?? '') || String(e.message));
  console.error('   手动修：npm run specs:index');
  process.exit(1);
}

console.log(`
下一步：
  1. 填 requirements.md 的 §1 目标与非目标、§5 验收判据（其余章节可随写随补）
  2. 状态推进：需求编写中 → 待评审 → 已评审确认 → 实施中 → 已实现
  3. 需要方案文档时：node scripts/new-spec.mjs ${slug} --design --force
  4. 索引已自动更新；改了别处导致索引过期时跑 npm run specs:index
`);
