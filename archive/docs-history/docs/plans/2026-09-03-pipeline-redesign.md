# 流水线页面原型实现计划（Pipeline Redesign）

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 按任务逐项实现本计划（或本会话 subagent-driven）。
> 前置设计文档：`docs/plans/2026-09-03-pipeline-redesign-design.md`（含 10 项已确认决策 D1-D10）。

**Goal:** 按原型稿重构 deploy-console「发布流水线」——列表页改摊平表格+筛选表单、详情页改 2-Tab 选中实例模式、节点点击三合一抽屉、新增执行记录删除端点。

**Architecture:** 前端（Vue3+antdv）复用 03ebf8f 已有的 `ProgressFlow`/`PipelineRunLogs`/`StageCommandDrawer`/`pipeline.stages.ts`，将其组合方式重构为「列表表格（PipelineCenter）→ 详情 2-Tab（PipelineDetail，selectedRun 状态驱动，URL `?run=` 深链）→ 三合一阶段抽屉」。后端新增 1 个删除端点。`PipelineRunDetail` 独立页废弃。

**Tech Stack:** Vue3 `<script setup>` / ant-design-vue / vue-router / NestJS / TypeORM / jest（仅后端）。

**测试策略：** 前端无 jest（build=vue-tsc+vite），前端任务验证 = `vue-tsc --noEmit` + vite build + 人工验收；后端任务严格 TDD（jest）。

---

## Task 1: 后端 `DELETE /pipelines/:id`（执行记录纯清理删除）

**Files:**
- Modify: `servers/deploy-console/src/pipeline/pipeline.controller.ts`（加路由）
- Modify: `servers/deploy-console/src/pipeline/pipeline.service.ts`（加 `remove()`）
- Test: `servers/deploy-console/src/pipeline/pipeline.service.spec.ts`（补 remove 用例）

**Step 1: 写失败测试（在 pipeline.service.spec.ts 内新增 describe）**

```ts
describe('remove（删除执行记录：纯清理）', () => {
  it('终态（succeeded）可删：调 repo.delete 并记审计', async () => {
    pipelineRepo.findOne.mockResolvedValue({ id: 'r1', status: 'succeeded', env: 'dev', moduleKey: 'admin', operator: 'u1' } as any);
    auditService.record = jest.fn().mockResolvedValue(undefined);
    repo.delete.mockResolvedValue({ affected: 1 } as any);
    await expect(service.remove('r1', 'admin-user')).resolves.toBeUndefined();
    expect(repo.delete).toHaveBeenCalledWith('r1');
    expect(auditService.record).toHaveBeenCalled();
  });
  it('running/pending/pending-approval 不可删：抛 BadRequestException', async () => {
    for (const s of ['running', 'pending', 'pending-approval']) {
      pipelineRepo.findOne.mockResolvedValue({ id: 'r1', status: s } as any);
      await expect(service.remove('r1', 'u')).rejects.toThrow(BadRequestException);
    }
  });
  it('不存在抛 NotFoundException', async () => {
    pipelineRepo.findOne.mockResolvedValue(null);
    await expect(service.remove('r1', 'u')).rejects.toThrow(NotFoundException);
  });
});
```
> 适配 spec 现有 repo mock 命名（读文件确认 `DeployPipelineEntity` 的 repo 变量名，如 `pipelineRepo`/`repo`）。

**Step 2: 运行确认失败** — `npx jest src/pipeline/pipeline.service.spec.ts -t remove --no-coverage` → FAIL（remove 不存在）

**Step 3: 最小实现**

`pipeline.service.ts` 新增（放在 cancel 附近，参考现有方法注入依赖与审计用法）：
```ts
/** 删除执行记录（纯清理：不动版本指针/产物）。running/pending 不可删。 */
async remove(id: string, operator: string): Promise<void> {
  const p = await this.pipelineRepo.findOne({ where: { id } });
  if (!p) throw new NotFoundException(`执行记录不存在: ${id}`);
  if (['running', 'pending', 'pending-approval'].includes(p.status)) {
    throw new BadRequestException('执行中/待审批的记录不可删除，请先停止或等待结束');
  }
  await this.pipelineRepo.delete(id);
  await this.audit.record({ action: 'delete_pipeline', target: id, operator, detail: { env: p.env, moduleKey: p.moduleKey, status: p.status } } as any);
}
```
`pipeline.controller.ts` 新增：
```ts
@Delete(':id')
@ApiOperation({ summary: '删除执行记录（纯清理，终态才可删）' })
async remove(@Param('id') id: string, @CurrentUser() user: { username: string }) {
  await this.pipelineService.remove(id, user?.username || 'system');
  return { ok: true };
}
```
> `@CurrentUser` / `CurrentUser` 装饰器名、audit.record 签名以现状文件为准（grep 同文件其他 delete/audit 用法对齐）。

**Step 4: 运行测试通过** — `npx jest src/pipeline/pipeline.service.spec.ts --no-coverage` → PASS；`npx tsc --noEmit` → OK

**Step 5: Commit** — `feat(deploy-console): 新增 DELETE /pipelines/:id 执行记录删除（纯清理+状态校验+审计）`

---

## Task 2: 前端 API 增加 `pipelineApi.remove`

**Files:**
- Modify: `apps/deploy-console/src/api/index.ts`（pipelineApi 内、`promote` 后加 remove）

**Step 1: 修改**

```ts
/** 删除执行记录（纯清理：不动版本指针/产物；running/pending 不可删） */
remove: (id: string) =>
  http.delete(`/pipelines/${id}`) as Promise<{ ok: boolean }>,
```

**Step 2: 验证** — `cd apps/deploy-console && npx vue-tsc --noEmit` → OK

**Step 3: Commit** — `feat(deploy-console): api 增加 pipelineApi.remove`

---

## Task 3: 前端日志按阶段切分工具（供三合一抽屉 Tab②）

**Files:**
- Create: `apps/deploy-console/src/components/pipeline/pipeline.logs.ts`

**Step 1: 新建工具（阶段标记行 `[ISO] [stage] msg`，命令执行行 `[stage] $ ...`）**

```ts
import type { PipelineItem } from '@/api'

/** 阶段进入行格式：[2026-09-03T12:00:00.000Z] [build] 执行阶段命令 ... */
const STAGE_HEAD_RE = /^\[[^\]]+\]\s*\[([a-z-]+)\]\s+/

/** 从实例 logs 中切出某个阶段自进入起到下一阶段前的全部日志行 */
export function stageLogLines(p: PipelineItem, stage: string): string[] {
  const lines = p.logs ?? []
  const heads: { stage: string; idx: number }[] = []
  lines.forEach((l, i) => {
    const m = STAGE_HEAD_RE.exec(l)
    if (m) heads.push({ stage: m[1], idx: i })
  })
  const start = heads.find((h) => h.stage === stage)
  if (!start) {
    // 无阶段标记：回退关键字过滤（老数据兼容）
    return lines.filter((l) => l.toLowerCase().includes(stage.toLowerCase()))
  }
  const next = heads.find((h) => h.idx > start.idx)
  return lines.slice(start.idx, next ? next.idx : undefined)
}

/** 提取某阶段是否有失败/错误标志（供结果 Tab 展示） */
export function stageHasError(lines: string[]): boolean {
  return lines.some((l) => /error|fail|失败|回滚/i.test(l))
}
```

**Step 2: 验证** — `npx vue-tsc --noEmit` → OK

**Step 3: Commit** — `feat(deploy-console): 阶段日志切分工具 pipeline.logs.ts`

---

## Task 4: 三合一阶段详情抽屉（命令/日志/结果）

**Files:**
- Modify: `apps/deploy-console/src/components/pipeline/StageCommandDrawer.vue`

**Step 1: 扩展 props（新增 instance + stage 上下文），命令 Tab 沿用现有逻辑**

script 增加：
```ts
import { ref, watch } from 'vue'
import type { PipelineItem } from '@/api'
import PipelineRunLogs from './PipelineRunLogs.vue'
import { stageLogLines, stageHasError } from './pipeline.logs'
import { STEP_LABELS, stepState, durationMs } from './pipeline.stages'

const props = defineProps<{
  open: boolean
  item: StageScriptItem | null
  /** 选中实例：用于日志/结果 Tab */
  instance?: PipelineItem | null
}>()
const drawerTab = ref<'command' | 'logs' | 'result'>('command')
watch(() => props.item?.stage, () => { drawerTab.value = 'command' })

const stageLines = computed(() =>
  props.instance && props.item ? stageLogLines(props.instance, props.item.stage) : [])
const stageErr = computed(() => stageHasError(stageLines.value))
const stageDur = computed(() => {
  // 阶段耗时无独立字段，以实例 total/当前进度粗略展示或省略；见结果 Tab 说明
  return null
})
```
> 日志 Tab 复用 `PipelineRunLogs :lines="stageLines"`（keyword 预填 stage 名、emptyText「该阶段暂无输出」）。
> 结果 Tab 展示：阶段状态（`stepState(instance, stage)` 映射 完成/执行中/失败/等待）、错误标志（stageErr → error alert）、实例级 error、产物/版本线索（stage 为 upload/version/pointer 时展示 `instance.versionTag`/`gitCommit`）。

**Step 2: 模板改为三段式（a-tabs 或头部 tab 切换）**

- 顶部：阶段名 + source 标签（复用现有 SOURCE_TAG）+ 实例 ID 短标。
- Tab ①命令：现有命令/内置说明完整保留（含复制、builtin alert）。
- Tab ②日志：`PipelineRunLogs`。
- Tab ③结果：`a-descriptions`（阶段状态 tag / 是否失败 / 实例状态 / 版本 commit）+ stageErr 红色 alert。
- 底部保留"真实执行命令见日志 [stage] $ 行"说明。

**Step 3: 验证** — `npx vue-tsc --noEmit` → OK

**Step 4: Commit** — `feat(deploy-console): StageCommandDrawer 升级三合一（命令/日志/结果）`

---

## Task 5: 详情页 PipelineDetail 重构为「selectedRun 2-Tab 模式」

**Files:**
- Modify: `apps/deploy-console/src/views/PipelineDetail.vue`

**Step 1: script 状态重构（关键改动）**

```ts
// 取代「latest = history[0]」的单一视图：selectedRun 独立维护
const selectedRunId = ref<string>('')
const selectedRun = ref<PipelineItem | null>(null)
const activeTab = ref<'flow' | 'history'>('flow')   // 默认进入「执行流程」tab

function pickRun(p: PipelineItem) {
  selectedRun.value = p
  selectedRunId.value = p.id
  router.replace({ query: { ...route.query, run: p.id } })  // 同步 URL ?run=
}
async function loadSelected() {
  const qRun = String(route.query.run || '')
  // 优先 ?run=；否则最新一条；无则 null（空态）
  const target = qRun
    ? history.value.find((h) => h.id === qRun) ?? (await pipelineApi.get(qRun))
    : history.value[0] ?? null
  if (target) pickRun(target)
}
// 轮询改为对 selectedRun：仅 isLive(selectedRun) 时 3s 拉 pipelineApi.get(selectedRunId)
```
- `?run` 变化（浏览器前进/后退）时 watch route.query.run 重载。
- `history` 仍由 `loadHistory` 一次性拉（Tab2 数据源，limit 200）。
- `handleRetry`/`handleCancel`/审批/promote 全部保留，但把确认后的 `afterChange` 改为：刷新 history + 重新 loadSelected（保留当前选中的 run 或切到最新）。

**Step 2: 顶部新增摘要条 + 操作栏（作用于 selectedRun）**

```
← 返回 | 流水线名（模块名+模板名）| [内置] | 12次·成功11 | [+ 发起发布] [重试/再次发布] [停止]
摘要条（Tab1 内）：#短ID · env · 分支 · 版本 · 操作人 · 状态tag · 耗时
```
- 按钮显隐沿用现有 `handleRetry`（failed/cancelled→重试；succeeded→再次发布）、`handleCancel`（running/pending→停止）。
- 「发起发布」按钮 = 现有 releaseOpen 抽屉（openRelease），预填 moduleKey=branch 由模板的模块/最近提交推导。

**Step 3: 模板结构调整**

- `a-tabs` 两个 key：`flow`（执行流程）、`history`（历史记录），默认 `flow`。
- Tab1 `flow`：空态（无 selectedRun → empty+发起按钮）→ 摘要条 → `ProgressFlow :instance="selectedRun"` → `PipelineRunLogs :lines="selectedRun.logs"`（关键词联动节点）。
  - ProgressFlow 事件：`stageClick` → 打开三合一抽屉并预切「日志」tab（或保持底部日志过滤）；`commandClick` → 打开三合一抽屉预切「命令」tab（调用现有 ensureScriptView + cmdItem）。
- Tab2 `history`：现有表格迁移，行操作：`详情`（pickRun + 切 tab `flow`）/`删除`（新增 handleRemove，仅非 running 显示，Modal.confirm 提示"仅移除记录，不影响版本指针与产物"）/`重试`（handleRetry）。**实例 ID 列改为可点**（router-link 样式 → pickRun + 切 tab）。
- 移除「查看完整详情 → /pipelines/:id/:runId」按钮与 gotoRun 逻辑。

**Step 4: 新增 handleRemove**

```ts
function handleRemove(p: PipelineItem) {
  Modal.confirm({
    title: '删除执行记录',
    content: `确定删除实例 ${p.id} 的记录吗？仅从历史列表移除，不影响当前版本指针与产物。`,
    okText: '删除', okType: 'danger', cancelText: '返回',
    onOk: async () => {
      await pipelineApi.remove(p.id)
      message.success('已删除')
      await loadHistory()
      if (selectedRunId.value === p.id) await loadSelected()
    },
  })
}
```

**Step 5: 验证** — `npx vue-tsc --noEmit` → OK

**Step 6: Commit** — `feat(deploy-console): PipelineDetail 改 selectedRun 2-Tab 模式（流程图/历史联动+删除+摘要条+?run 深链）`

---

## Task 6: 列表页 PipelineCenter 改摊平表格 + 筛选表单

**Files:**
- Modify: `apps/deploy-console/src/views/PipelineCenter.vue`

**Step 1: 数据结构（摊平「模块×模板」）**

```ts
const rows = computed(() => {
  const out: { tpl: PipelineTemplate; module: any; summary: { total: number; ok: number; latest: PipelineItem | null } }[] = []
  for (const tpl of templates.value) {
    // 取该模板对应模块（tpl.moduleKey='*' 全局模板 → 跳过或归入「全局」分组，见 D1：保留模板体系但列表行=模块×模板）
    const mod = availableModules.value.find((m) => m.key === tpl.moduleKey)
    if (!mod) continue
    out.push({ tpl, module: mod, summary: summaryMap.value[tpl.id] ?? { total: 0, ok: 0, latest: null } })
  }
  return out
})
const filteredRows = computed(() => rows.value.filter(/* 四维度前端过滤 */))
```

**Step 2: 筛选表单（四维度，D7）**

- 状态：`fKeyword / fModule / fType / fStatus` + `doSearch/resetFilters`。
- 筛选逻辑：keyword 匹配 模块名/模板名/moduleKey；fModule 精确；fType=builtin 布尔；fStatus=latest.status（running/succeeded/failed/从未执行=无 latest）。

**Step 3: 表格列与操作**

- 列：流水线名（模块名 + 模板名非默认时 `-模板名`）/ 类型 tag（内置/自定义）/ 模块 key / 最近执行（状态 tag+版本+时间短）/ 成功率（total·ok）/ 操作。
- 操作列：`详情`→`/pipelines/${tpl.id}`；`编辑`→复用现有模板编辑 Modal（找到现状 openEdit 逻辑）;`执行`→复用现有发起发布抽屉（openRelease，预填 moduleKey=tpl.moduleKey）。
- 保留页头「+ 新建流水线」（复用模板新建 Modal）。
- 移除顶部「执行记录」「发起发布」全局按钮（D8）；相关全局抽屉代码删除或收敛到行操作复用。

**Step 4: 验证** — `npx vue-tsc --noEmit` → OK

**Step 5: Commit** — `feat(deploy-console): PipelineCenter 改摊平表格+四维筛选+新建入口`

---

## Task 7: 移除 PipelineRunDetail 独立页

**Files:**
- Modify: `apps/deploy-console/src/router/index.ts`
- Delete: `apps/deploy-console/src/views/PipelineRunDetail.vue`

**Step 1:** router 删除 `pipelines/:id/:runId` 路由注册；确认无其它入口引用 `/pipelines/${id}/${runId}`（grep PipelineRunDetail、gotoRun），删除文件。

**Step 2:** `npx vue-tsc --noEmit` → OK（确认无 dangling import）

**Step 3: Commit** — `refactor(deploy-console): 废弃 PipelineRunDetail 独立页（功能并入详情 Tab1）`

---

## Task 8: 集成验证 + 发布

**Step 1: 本地自检**
```bash
cd servers/deploy-console && npx jest --no-coverage          # 后端全绿
npx tsc --noEmit                                              # 后端 TS
cd apps/deploy-console && npx vue-tsc --noEmit                # 前端 TS
```

**Step 2: 手工验收（对照 design §八）**：列表筛选/行操作 → 详情默认最新流程图 → 节点三合一（命令正确=当前模块 DB 命令；日志=该阶段段落；结果=状态）→ 历史删除（终态成功/失败记录删，running 记录删除不可用）→ 点 ID 切 Tab1 → ?run= 刷新复原 → 对 running 实例停止。

**Step 3: 传统发布**（deploy-console 自身，勿走流水线）：工作区 commit&push → `~/web_system_release` reset 分支 → 发布目录 `nest build` + `vite build` → 干净 env `pm2 restart web-deploy-console` → 校验 6200 占用=pm2 pid → curl 新接口/前端 chunk。

**Step 4: Commit**（如有修复）
