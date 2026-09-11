# 方案 · deploy-console（发布平台自身）的 CI/CD

> 类型：方案对比（待决策）
> 日期：2026-09-11
> 关联：`specs/ci-cd/design.md`（CI/CD 单一事实源，冲突以该文为准）· `docs/development/local-release-runbook.md`（运维现状）
> 前身：本文取代同日草稿 `local-auto-deploy.md`（当时把范围放成了"所有模块的本地自动发布"，范围过大）

---

## 一、范围与边界（先划清楚）

| 对象 | 谁负责发布 | 本文是否涉及 |
|---|---|---|
| **deploy-console 自己** | **没有平台可用**（它是平台本身，流水线发布自己会在 restart 阶段把执行者杀掉） | ✅ **本文只讨论它** |
| admin / portal / 各后端服务 | 通过 deploy-console 控制台 / MCP / hook 触发流水线 | ❌ 已有能力，不在此范围 |

**一句话**：其他模块是平台的**用户**，可以用平台的治理能力；而平台自己**用不上自己的治理** —— 这就是本文要解决的唯一问题。

---

## 二、结论先行

**deploy-console 现在有一条能跑的发布通道（`scripts/publish-deploy-console.sh`），但它绕过了平台治理**：

| 治理能力 | 其他模块（走流水线） | deploy-console（走脚本） |
|---|---|---|
| 版本记录 / 指针 | ✅ `deploy_versions` + `deploy_deployments` | ❌ **版本表里查不到它的记录**（实测） |
| 审计 | ✅ `audit` | ❌ 无 |
| 产物归档 / 可回滚 | ✅ ArtifactStore + 版本表 | ⚠️ 磁盘有目录，但**无版本记录、不可按版本回滚** |
| 探活 | ✅ verify 阶段 | ✅ 脚本有健康复检 |
| 失败自动回滚 | ✅ verify 失败自动回滚 | ❌ 脚本直接 err 退出 |
| 发布锁 / 审批 / 通知 / 度量 | ✅ | ❌ 无 |

推荐方案（§五）：**不自研第二套治理，而是让流水线跑它能跑的部分（check→pull→build→upload→version→pointer），把唯一无法在自身进程内完成的「重启 + 探活」交给外部收尾器**。平台侧**不改代码**，只需要一个不含 restart 的流水线模板。

---

## 三、为什么"自发布"是结构性难题

deploy-console 是流水线引擎本体。流水线执行 `restart` 阶段时执行 `pm2 restart web-deploy-console`：

```
流水线进程（= deploy-console 自己）
  └─ check → pull → build → upload → version → pointer → restart ← 在这里把自己杀掉
                                                          ↓
                                          后续 verify/cleanup 永远不会执行
                                          流水线状态永远停在 running，发布锁不释放
```

2026-09-11 实测踩到：watcher 把 deploy-console 当普通模块发，流水线卡在 `running | restart`，占着 `deploy-console@local` 锁，后续发布被拒。

**注意**：这不是"加个延迟重启"就能解决的 —— `restart` 之后还有 `version/pointer/verify/cleanup` 四步都由同一个进程执行，其中 `version`/`pointer` 是**发布语义真相源**（必须由平台写、不能由 CI 或脚本直接写库，见 `ci-cd/design.md` 铁律 1）。

---

## 四、现状：`publish-deploy-console.sh` 做了什么

| 步骤 | 说明 |
|---|---|
| 1 | 发布目录 `fetch + merge --ff-only`（不做 reset --hard，避免误伤） |
| 2 | 后端 `nest build` |
| 3 | 前端 `vite build`（取出新 `index-*.js` 作为版本证据） |
| 4 | 干净 env 重启 + **孤儿进程铁律**（6200 占用者必须 == pm2 pid）+ 一致性校验 + 重试 |
| 5 | `pm2 save` |
| 6 | 健康复检（`/console/` 200） |

**能跑、且质量不错**（孤儿进程、env 污染这些历史坑都内建了）。**缺的是治理侧**（§二表格右列）。

---

## 五、CD 侧方案对比

| 方案 | 做法 | 治理完整性 | 平台改动 | 评价 |
|---|---|---|---|---|
| **A. 纯外部脚本补齐** | 脚本自己调平台内部接口写版本表/审计、cp 产物到 `static/modules/deploy-console/<commit>/` | 中（脚本自实现，易漂移） | 无 | 能用，但等于在平台外重造一套治理 |
| **B. 流水线拆分 + 外部收尾**（推荐） | 平台跑 `check → pull → build → upload → version → pointer`（**用不含 restart 的模板**），外部收尾器负责 `重启 + 探活 + 失败回滚` | **高**（版本/审计/产物/锁全由平台产生） | **零代码**（只加一个模板） | ✅ 治理归位，职责清晰 |
| **C. 双实例蓝绿** | 6200 跑 A/B 两实例 + 反代切换，流水线只重启"非活跃"实例 | 高 | 架构级改造 | 重，暂不考虑 |

### 方案 B 的两个组件

**B1 · 平台侧：新增「deploy-console 自发布」流水线模板**

- 模板步骤：`check`、`pull`、`build`、`upload`、`version`、`pointer`（**不含 `restart` / `verify`**）；
- 平台零代码改动 —— 模板本就是数据（`deploy_pipeline_templates`），可在「流水线模板」页建；
- 效果：每次自发布都会在 `deploy_versions` / `deploy_deployments` 留痕，产物按 commit 归档，可在控制台看到历史与当前版本，指针语义与其他模块一致。

**B2 · 外部侧：把 `publish-deploy-console.sh` 升级为「收尾器」**

```
① 提交模板 B1 的流水线（branch = 当前集成分支/目标分支）
② 轮询至终态；失败 → 直接报错，不动线上（此时线上还是旧版本，天然安全）
③ 成功 → pm2 restart web-deploy-console（沿用现有"孤儿铁律 + 一致性校验"）
④ 探活 /console/（+ /api/deploy/modules 这类关键接口）
⑤ 探活失败 → 用流水线 pointer 能力把版本切回上一版并重启（自动回滚），再报错
⑥ 通知 + 审计（由平台流水线产生，无需脚本再写）
```

**关键点**：③④⑤ 是唯一必须放在外部的原因（在进程内重启自己 = 自杀）；而 ①②⑥ 全部复用平台的锁/版本/审计/回滚语义。

**触发方式**（B2 由谁调用）—— 三种，按需选择：

| 触发 | 前提 | 适用 |
|---|---|---|
| 人工执行脚本 | 无 | 现在的做法，最稳 |
| 本地轮询 watcher（已上线 `web-release-watcher`） | 无 | 本地联调全自动 |
| GitHub Actions（self-hosted runner） | 本机注册 runner | 要统一 CI 入口/记录时（详见 §七） |

---

## 六、CI 侧设计（研发门禁）

deploy-console 是平台，**它坏了会波及所有模块的发布**，因此它的门禁应比普通模块更严。

| # | 门禁项 | 现状 | 建议 |
|---|---|---|---|
| 1 | 红线扫描 R1~R5 | ✅ `quality-gate.yml` | 保持 |
| 2 | 改动包 `build`（= 类型检查）+ `test` | ✅ `scripts/ci/changed-packages.sh "$BASE" --lint`（覆盖 `servers/deploy-console`） | 保持 |
| 3 | **流水线引擎契约测试** | 有单测（`pipeline.service.spec`、`step-registry.spec`、`template-node.spec`、`release-hook.service.spec`、`stage-command.*.spec` …）但**不保证在 CI 全跑** | 明确：deploy-console 相关改动必须跑全量 `test`（不止改动包，因为它是引擎，跨文件耦合） |
| 4 | **迁移守卫** | 无（库靠 TypeORM `synchronize`，见 `ci-cd/design.md` G4） | 改了 `servers/deploy-console/src/entities/*.entity.ts` ⇒ 必须有对应 `migrations/*.sql`，否则 CI 红 |
| 5 | **feature/test 也跑门禁** | 只跑 master 的 PR | 建议给 `quality-gate.yml` 增加 `feature/test` 作为 PR base（集成分支是入 master 前最后一道） |

---

## 七、与"本地触发"的关系（原 `local-auto-deploy.md` 的收敛版）

本地（或任何跑着 deploy-console 的机器）触发方式四选一：

| 方案 | 触发源 | 前提 | 延迟 | 成本 | 判断 |
|---|---|---|---|---|---|
| 轮询 watcher（**现状**） | 本机 git fetch | 无 | ≤30s | 零 | ✅ 已上线可用 |
| self-hosted runner + Actions | GitHub push | 本机注册 runner | 秒级 | 中（安全面需评估） | 需要"统一入口/CI 记录"时再上 |
| Webhook + 内网穿透 | GitHub → 公网 → 本机 | 暴露本机端口 | 秒级 | 中高 | ❌ 不值当 |
| 制品化（design P1） | 云上构建 → 本地拉制品 | 制品库 + 改步骤命令 | 分钟级 | 高 | 解决"构建位置"，与本文正交 |

**注意**：方案 B 的流水线仍有 `build` 阶段（在发布目录现场构建）。若将来做 P1 制品化，B1 模板的 `build` 改为"拉制品解包"即可（改 DB 命令，不改代码）。

---

## 八、需要你决策的点

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| D1 | 自发布走哪条路 | A 纯脚本补齐治理 / **B 模板拆分 + 外部收尾** / C 双实例 | **B**：平台零代码，治理能力立刻归位 |
| D2 | 是否给 deploy-console 纳入版本表治理 | 是 / 否 | **是**（否则它永远是"治理盲区"，也没法按版本回滚） |
| D3 | CI 门禁补强先做哪个 | 契约测试全跑 / 迁移守卫 / `feature/test` 门禁 | 建议顺序：`feature/test` 门禁 → 迁移守卫 → 契约全跑 |
| D4 | 外部收尾器由谁触发 | 人工 / 轮询 watcher（现状）/ self-hosted runner | 保持轮询；需要 CI 记录再上 runner |
| D5 | 自动回滚的判定 | 仅探活失败 / 探活 + 关键接口断言 | 建议"探活 + `/api/deploy/modules` 可用"两条 |

---

## 九、验收标准

1. 当 deploy-console 需要发布时，`deploy_deployments` 中 `deploy-console@<env>` 的 `current_version` 应更新为本次 commit，且 `deploy_versions` 有对应记录。
2. 当自发布流水线成功但探活失败时，应自动把指针切回上一版本并重启，最终对外服务可用。
3. 当流水线自身中断（含"执行者被重启"这类极端情况）时，发布锁应在 TTL 内释放，不阻塞后续发布。
4. 当 `entities/*.entity.ts` 变更而无对应迁移文件时，CI 应失败。
5. 全程 `audit` 中应能查到 deploy-console 的发布记录，operator 可追溯（人工 / `watch:feature/test` / `ci:<workflow>`）。
