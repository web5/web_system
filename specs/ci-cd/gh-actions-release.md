# 方案 · 用 GitHub Actions 作为统一 CI/CD（提交 → PR → 自动发布）

> 类型：方案（待决策）
> 日期：2026-09-11
> 关联：`specs/ci-cd/design.md`（CI/CD 单一事实源）· `docs/development/local-release-runbook.md`（本地运维现状）
> 取代：同日的 `deploy-console-devops.md`（那版想给 deploy-console 自发布补平台治理，结论是"不好实现"，改为本文方向）

---

## 一、结论先行

**采用 GitHub Actions 作为唯一的 CI/CD 入口，按模块分流发布：**

| 模块 | 发布方式 | 为什么 |
|---|---|---|
| admin / portal / 各后端服务 | Actions **投递发布意图**（HMAC → `POST /api/hooks/release`）→ 平台流水线执行 | 平台治理（锁/审批/审计/回滚/版本指针）都能用上，且已有能力 |
| **deploy-console 自己** | Actions job **直接执行**（在发布目录 `nest build` + `vite build` + pm2 restart + 探活） | **它用不了自己的流水线**：restart 阶段会杀掉执行者，且其后还有 version/pointer/verify 同在进程内（详见 §五） |

**一句话**：不是"平台发布 vs Actions 发布"二选一，而是**同一个 `release.yml` 里按模块分流** —— 普通模块走平台（拿治理），平台自己走直连（拿可用性）。

---

## 二、目录与角色（先把约定立起来）

| 角色 | 路径 | 职责 |
|---|---|---|
| **研发工程目录**（workspace） | `~/workspace1/web_system` | 人在这里改代码、提交、开 PR；CI 只读它做校验 |
| **发布目录**（release） | `~/web_system_release` | 服务实际运行处（pm2 的 `dist/main.js` 都在这里）；**一切发布动作的落点** |
| **runner 工作副本** | `<runner>/_work/web_system/web_system` | self-hosted runner 自动维护的检出，仅用于"读代码解析改动模块"，**不是发布落点** |

**铁律**（沿用 `local-release-runbook.md`）：
1. 发布 = 改发布目录 + 重启 pm2，**与研发目录无关**（在研发目录构建不会生效）；
2. 前端产物必须落到 `release/servers/gateway/public/static/modules/<module>/<version>/`（nginx alias 指向 release）；
3. 端口占用者必须等于 pm2 当前 pid，否则先清孤儿（脚本已内建）。

---

## 三、目标流程

```
开发者
  │  ① 功能分支开发 → push
  ▼
GitHub PR（base = feature/test 或 master）
  │  ② ci.yml（托管 runner，便宜、隔离）：红线扫描 + 改动包 build/test
  │     ⇒ 红则挡住合并
  ▼
合并（merge）
  │  ③ release.yml（self-hosted runner，必须在能访问发布目录/部署平台的机器上）
  │     ├─ 解析本次改动模块（servers/* 、apps/* 目录名）
  │     ├─ deploy-console 在列表里？ → 直连执行发布（§五 B 路径）
  │     └─ 其余模块 → 逐个 HMAC 投递平台 hook，轮询到终态
  ▼
发布完成（Actions 日志 = 完整记录；平台侧另有审计与版本表）
```

**环境映射**（建议，待你确认）：

| 事件 | 发布到 | 用途 |
|---|---|---|
| 合并到 `feature/test` | `local`（本机发布目录） | 日常联调，多分支集成分支 |
| 合并到 `master` | `dev`（远程服务器） | 集成验证 |
| `workflow_dispatch` | 手选 `local/dev/staging/prod` | 应急/补发 |

---

## 四、需要新增/改造的文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `.github/workflows/ci.yml` | **新增**（或把 `quality-gate.yml` 改名并补强） | PR 校验：红线 + 改动包 build/test（+ 可选 lint） |
| `.github/workflows/release.yml` | **改造**（已存在，P0 建的） | ① 触发加 `feature/test`；② 环境按分支映射；③ **新增 deploy-console 直连路径**；④ 加 `concurrency` 防并发 |
| `scripts/release-deploy-console.sh` | **新增（薄封装）** | Actions 里调用：`--skip-sync` 复用现有 `publish-deploy-console.sh`，并补"发布后记一条版本/审计"（可选） |
| `docs/development/gh-actions-release.md` | 新增 | 面向使用者的操作手册（跑哪些、怎么看、失败怎么办） |

**`release.yml` 的改造要点**（现有实现已含：解析改动模块、HMAC 签名、`deliveryId` 幂等、轮询终态）：

```yaml
on:
  push:
    branches: [master, main, feature/test]   # ← 新增集成分支
  workflow_dispatch: { inputs: { env, modules } }

concurrency:
  group: release-${{ github.ref }}           # 同一分支的发布串行，不互相打断
  cancel-in-progress: false

jobs:
  release:
    runs-on: [self-hosted, local-release]    # ← 打 label，避免跑到别的机器
    steps:
      - 解析改动模块（已有）
      - 若含 deploy-console → 直连：在 $RELEASE_DIR 执行 publish-deploy-console 流程
      - 其余模块 → HMAC 投递 hook + 轮询（已有）
```

---

## 五、两个关键设计

### A. 环境与触发映射

- `feature/test` → `local`：集成分支是"多人成果合流处"，用它做本地联调最合适；
- `master` → `dev`：master 是稳定线，发远程 dev 做集成验证；
- 其他环境（staging/prod）走 `workflow_dispatch` 手动指定，保留审批语义（平台侧 prod 仍需审批）。

### B. deploy-console 为什么"直连执行"，以及怎么做

**为什么不能走平台**（实测 + 代码依据）：

```
流水线进程 = deploy-console 自己
  check → pull → build → upload → version → pointer → restart ← 在这里杀掉自己
                                                        ↓
                              verify / cleanup 永不执行，流水线永久停在 running，锁不释放
```

且 `restart` 之后还有 `version/pointer`（发布语义真相源，必须由平台写，不能让脚本直写库）——所以"延迟重启"补不了这个洞。

**怎么做**（复用已有脚本，零新逻辑）：

1. Actions job 在发布目录执行：`git fetch && git merge --ff-only origin/<branch>`；
2. 跑 `scripts/publish-deploy-console.sh --skip-sync`（内含：nest build → vite build → 干净 env 重启 → **孤儿进程铁律与一致性校验** → `pm2 save` → 健康复检）；
3. 失败即 job 红；
4. **可选增强**（若你也希望它在平台里可查）：脚本末尾调平台内部接口补记一条版本/审计，让「发布流水线」页能看到 deploy-console 的版本历史。

**代价**：deploy-console 的发布不进平台流水线（无锁/审批/回滚语义），换来的是"能发布"。这是有意的取舍。

---

## 六、前置条件（当前缺哪几项）

| # | 项 | 现状 | 要做 |
|---|---|---|---|
| 1 | **self-hosted runner** | ❌ **本机未安装**（已确认） | 在发布机安装并注册，打 label `local-release`；**注意 runner 的 PATH 要含 node/pm2**（fnm 环境），否则脚本找不到 `nest`/`pm2` |
| 2 | `RELEASE_HOOK_SECRET`（平台侧） | ✅ 已配置（非空） | — |
| 3 | 仓库 Secrets：`RELEASE_HOOK_URL` / `RELEASE_HOOK_SECRET` / `DEPLOY_CONSOLE_TOKEN` | ⚠️ 未知（当前 PAT 无权限查看） | 在仓库 Settings → Secrets 配齐；`DEPLOY_CONSOLE_TOKEN` 建议用 CI 专用账号并定期轮换 |
| 4 | 发布目录 git 凭据 | ✅ 已能 fetch/push | 确认 runner 以当前用户身份运行（能读 `~/.ssh`） |
| 5 | runner 的 skills 权限边界 | — | runner 能在本机执行命令 ⇒ **只有受信人可合并到被监听分支**（安全前提，需明确） |

---

## 七、落地步骤（runner 就绪后，半天内可完成）

1. **装 runner**（发布机）：
   ```bash
   mkdir -p ~/actions-runner && cd ~/actions-runner
   curl -o actions-runner.tar.gz -L https://github.com/actions/runner/releases/download/<ver>/actions-runner-osx-arm64-<ver>.tar.gz
   tar xzf actions-runner.tar.gz
   ./config.sh --url https://github.com/web5/web_system --token <REG_TOKEN> \
     --labels local-release --name mac-release --work _work
   ./svc.sh install && ./svc.sh start        # 开机自启
   ```
   （`REG_TOKEN` 在仓库 Settings → Actions → Runners → New runner 处获取；临时 token 1 小时有效）

2. **配 secrets**（仓库 Settings → Secrets and variables → Actions）。

3. **改 workflow**（本文 §四），push 到功能分支 → 提 PR → 合并验证。

4. **验证**：合并一个只改 `apps/admin` 的 PR → Actions 里应看到 `release` job 只发 admin（不是全量）；再合并一个改 `servers/deploy-console` 的 PR → 应走直连路径并成功重启。

5. **决定 watcher 去留**（§八 D4）。

---

## 八、决策点（请逐条拍）

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| D1 | runner 装在哪 | 本机（发布机）/ 独立机器 | **本机**（发布目录就在这里；独立机器会让"发布目录在本机"的前提失效） |
| D2 | 触发→环境映射 | 按 §五 A / 其他 | 按建议（`feature/test→local`、`master→dev`） |
| D3 | deploy-console 发布方式 | **Actions 直连执行** / 继续人工跑脚本 / 补平台治理 | **直连执行**（你已指出平台自发布不好实现） |
| D4 | 本地轮询 watcher 是否保留 | 停用 / 保留兜底 | 建议**降级为兜底**：Actions 正常时不生效，机房里 runner 掉线也能自愈 |
| D5 | 是否需要"提交即发"（不等 PR 合并） | 只合并发 / push 即发 | 建议**只合并发**（push 即发会让回滚与审计失去意义） |
| D6 | CI 是否给 `feature/test` 加门禁 | 加 / 不加 | **加**（集成分支是入 master 前最后一道） |

---

## 九、验收标准

1. 当合并（含改动 `apps/admin`）到 `feature/test` 时，Actions 应触发 `release` job，**只发 admin**，且发布到 `local` 成功后 `deploy_deployments.admin@local` 版本更新。
2. 当合并（含改动 `servers/deploy-console`）时，Actions job 应走直连路径完成构建+重启+探活，且 `/console/` 返回 200。
3. 当同分支连续两次合并时，两次发布应**串行**执行（`concurrency` 生效），不出现"两个发布互相重启"。
4. 当 `ci.yml` 失败时，PR 不应可合并（配合分支保护）。
5. 全程审计可追溯：平台侧 operator 为 `ci:release.yml`；deploy-console 直连路径至少在 Actions 日志中可回溯（若采纳 §五 B-4，则平台侧也有记录）。
