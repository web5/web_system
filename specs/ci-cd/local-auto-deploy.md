# 方案 · 本地（local）环境自动发布的触发方式选型

> 类型：方案对比（待决策）
> 日期：2026-09-11
> 关联：`specs/ci-cd/design.md`（**CI/CD 单一事实源**，本文是它在 local 场景的补充，冲突以该文为准）
> 定位：只回答一个问题 —— **"本地发布目录自动更新"这件事，该用 GitHub Actions / Webhook，还是轮询？**

---

## 一、结论先行

**"用 Actions + Webhook" 这个方向是对的，但要分层看：**

| 环境 | 触发方式 | 状态 |
|---|---|---|
| dev / prod（云上有公网） | GitHub Actions（`release.yml`）→ HMAC 签名 → `POST /api/hooks/release` → Beehive 流水线 | **已是该方案**（P0 已落地） |
| **local（本机）** | GitHub 托管 runner **到不了本机**，Actions 事件天生覆盖不到 | **缺口**，当前用轮询 watcher 补位 |

**所以真正要决策的不是"要不要用 Actions"，而是"本地这一格，用哪种触发器"** —— 四个候选见 §三，推荐见 §四。

**一条必须守住的原则**（与 `ci-cd/design.md` D2/D6 一致）：无论用哪种触发器，**执行权始终在 Beehive 流水线**（锁/审批/审计/回滚/度量），触发器只递"发什么、发到哪"，绝不 SSH 到目标机执行命令。

---

## 二、现状事实（都已验证）

1. **CI → CD 通道已存在**：`POST /api/hooks/release`（`release-hook.controller.ts`）—— HMAC-SHA256 验签（`X-Hub-Signature-256`）+ 时间戳防重放（±300s）+ `deliveryId` 幂等，内部复用 `PipelineService.submit`。
2. **`release.yml` 明确要求 `runs-on: self-hosted`**，注释写了原因：deploy-console 在内网 `127.0.0.1:6200`，**GitHub 托管 runner 访问不到**。
3. **CI 门禁已存在**：`quality-gate.yml`（红线 + 改动包 build/test）、`kit-gate.yml`、`auto-pr.yml`。
4. **CD 引擎完整**：九阶段流水线（步骤注册表驱动）、版本/指针真相源、探活、锁、审批、灰度、回滚、通知、度量。
5. **local 环境现状**：轮询 watcher（`scripts/watch-integration.mjs`，pm2 常驻 `web-release-watcher`）已上线并实测通过 —— 盯 `origin/feature/test`，有新提交则同步发布目录 + 全量发布（跳过本地不可发布模块，deploy-console 走专用脚本）。

---

## 三、四个候选方案

| 方案 | 触发源 | 前提条件 | 延迟 | 引入成本 | 主要风险 |
|---|---|---|---|---|---|
| **A. 轮询 watcher**（现状） | 本机 `git fetch` | 无 | ≤30s | **零**（1 个 pm2 进程） | 延迟非实时；本机需常开 |
| **B. self-hosted runner + `release.yml`** | GitHub push event | 本机注册 runner（label 如 `local-release`），仓库 Secrets 配好 | 秒级 | 中（装/维护 runner） | runner 拥有"在内网执行命令"的能力，安全面需评估；本机需常开 |
| **C. Webhook + 内网穿透** | GitHub → 公网 → 本机 | 暴露本机端口（ngrok/frp）+ 证书 | 秒级 | 中高 | **把内网服务暴露到公网**，为主机开发不值当 |
| **D. 制品化（`ci-cd/design.md` P1）+ 本地只投递** | Actions 云上构建 → 制品库 → 本地拉取 | 制品库（GHCR/Release Asset）+ 流水线改步骤命令（改 DB，不改代码） | 分钟级（构建在云上） | 高（属 P1 范围） | 与 P1 同期；本地不再构建，构建环境问题从根上消失（解 G2/G3） |

### 关键判断

- **C 直接排除**：为了"本地保存即部署"把开发机端口暴露到公网，收益与风险完全不匹配。
- **A 与 B 的差别只在"事件来源"**：A 是本地主动拉，B 是 GitHub 主动推。CD 执行、治理、审计三者完全相同（都进 Beehive）。
- **D 不是"触发方式"，而是"构建位置"的改变**：做完 P1，本地只是"投递与运行"，触发问题会退化为"谁通知本地拉制品"，仍要选 A 或 B。
- **D7 已给出取向**（`ci-cd/design.md`）："self-hosted runner 作为**可选加速**；但触发链路不变（仍经 Beehive），避免回到'执行者在本机'的老问题"。

---

## 四、推荐路径（分阶段，逐段决策）

### 第 0 阶段 · 已完成：轮询 watcher 闭环（方案 A）

**收益**：本地"合并到 `feature/test` ⇒ 自动全量发布"立刻可用，零新增面（无公网暴露、无 runner 权限、无额外凭据）。
**代价**：≤30s 延迟；非实时；本机必须常开（这也是 G2 的既有事实，不是本方案引入的）。

### 第 1 阶段 · 可选：把 local 纳入统一触发入口（方案 B）

**什么时候做**：当你需要下面任一项时 ——
- 统一的可观测性（本地发布也要有 Actions 侧的运行记录）；
- 合并前自动跑一遍"本地部署验证"（PR 阶段就能验证集成分支能部署起来）；
- 不再想维护一个自研 watcher。

**要做的事（4 步）**：

1. 本机注册 self-hosted runner（label `local-release`），只给本仓库；
2. `release.yml` 的 `runs-on` 支持该 label，`env` 参数从 `dev/prod` 扩到包含 `local`；
3. 触发事件从"push master"扩到"push `feature/test`"（或 `workflow_dispatch` 手动）；
4. 停用轮询 watcher（或降级为兜底：runner 掉线时它仍能拉平）。

**必须一并确认的安全边界**：
- runner 能在本机执行任意命令 ⇒ 仓库的写权限持有者等于本机命令执行权限，需明确"只有受信任的人能 merge 到被监听的分支"；
- runner 不进公网（仅本机 + GitHub 出站连接）；
- 触发端点仍用 HMAC + 幂等（已有）。

### 第 2 阶段 · 与 P1 制品化合并考虑

做完 `ci-cd/design.md` 的 P1（GHCR + Release Asset）后：
- 本地不再"git pull + 现场构建"，改为"拉制品 + 投递 + 重启"（解 G2/G3）；
- 此时无论触发器是 A 还是 B，watcher/Actions 的职责都变轻，且**同一 commit 的产物全局一致**（dev 验过的就是 prod 发的）。

---

## 五、需要你决策的点

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| D1 | 本地是否纳入 CI 统一入口 | ① 保持轮询（A）② 上 self-hosted runner（B） | **先 ①**；等出现"要看 Actions 记录 / 想在 PR 阶段验证本地部署"的真实需求再上 ② |
| D2 | 若上 runner：接受其安全面吗 | 接受 / 不接受 | 需要你明确"谁能合并到被监听分支"这个前提 |
| D3 | `feature/test` 合并后要不要跑 CI 门禁 | ① 只触发发布 ② 也跑 `quality-gate`（红线+build/test） | 建议 ② —— 集成分支是合入 master 前的最后一道，跑门禁收益最高；实现上只是给 `quality-gate.yml` 加一个 base 分支 |
| D4 | 是否按 P1 推进制品化 | 现在 / 稍后 | 与本文解耦，按 `ci-cd/design.md` 节奏走；但**它决定了本地方案的终局形态** |
| D5 | 轮询间隔 | 30s / 更长 | 30s 够用；若觉得频繁可调 `--interval` |

---

## 六、验收标准（若决策为"保持 A"，用来验证现状；若决策为 B，加第 3 条）

1. 当 `feature/test` 有新提交时，≤1 分钟内发布目录被同步，并开始全量发布；发布期间不重复触发。
2. 当某个模块发布失败时，其余模块继续，结束后汇总列出失败项，且不重复发布同一提交。
3. （方案 B）当 push 到被监听分支时，GitHub Actions 运行记录中可见该次触发，且本地流水线 operator 可追溯到 `ci:<workflow>`。

---

## 七、与既有文档的关系

- `specs/ci-cd/design.md`：CI/CD 单一事实源；本文只补 local 场景，凡冲突以该文为准。
- `docs/development/integration-branch.md`：`feature/test` 集成分支与 watcher 的**使用手册**（面向日常操作）。
- `docs/development/local-release-runbook.md`：本地发布目录的运维现状。
