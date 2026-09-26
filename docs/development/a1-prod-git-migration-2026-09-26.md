# A1：prod 转 git 仓库方案（2026-09-26）

> 目标：让 prod（`root@106.52.176.246` / `/data/web_system`）从"无版本控制"转为可 `git pull` 的仓库，
> 这是轨道 B（流水线发布）的**唯一前置**——prod 连 git 都不是，流水线必然失败。
>
> 本文所有数据均来自 2026-09-26 SSH 实测，非文档推测。

---

## 1 prod 现状实测台账

| 项 | 实测值 |
|---|---|
| 主机 / 目录 | `root@106.52.176.246` / `/data/web_system` |
| 是否 git 仓库 | ❌ **否**（无 `.git`，`git log` exit 128） |
| git 客户端 | ✅ 已装 `git version 2.27.0` |
| 目录体积 / 磁盘 | 819M / 50G 用 21G，**剩 27G** |
| node_modules | 465M（完整，可复用） |
| pm2 进程 | 8 个全 online：`ai-service`(restarts **1002**)、`gateway`(restarts **578**)、auth-service / content-hub / mcp-gateway / system-service / todo-service / user-service |
| pm2 cwd | 全部 `/data/web_system` |
| NODE_ENV | 服务的 `.env` 里**均为空**，但 `ecosystem.config.js` 注入了 `production` → **synchronize 实际是关的** ✅ |
| 用户上传数据 | ❌ **不存在**（无 `uploads/` 目录、无 avatar 文件）→ **迁移零数据丢失风险** |
| 运行时数据 | 8 份 `servers/*/.env`、`logs/`(134M)、`servers/gateway/public/`、3 个 `ecosystem.config.js.bak-*` |
| 缺失服务 | deploy-console / ai-agent / knowledge-service（无 dist 无 .env）；upload-service **有 dist 无 .env**（构建了但从未启动） |

### 1.1 prod 源码与 master 的差异（本次用 bundle 回传本地实测）

| 指标 | 值 |
|---|---|
| 差异文件总数 | **4007** |
| prod 独有文件（master 里没有） | 2065（其中 **1275 个是 `._*` macOS 元数据垃圾**，163B/个） |
| 过滤垃圾后真实独有 | **790** |

真实独有的构成：

| 类别 | 数量 | 处置 |
|---|---|---|
| `servers/gateway/public/**`（admin 前端构建产物） | 671 | **必须保留/重建**，丢了 admin 页面 404 |
| `src/**`（旧单体结构：`bianbian` / `auth` / `user` / `qrcode`…） | 132 | 已废弃，可删 |
| 各服务 `pnpm-lock.yaml` / `pnpm-workspace.yaml` | ~10 | 可删（master 已清理同类） |
| `ecosystem.config.js.bak-20260821` / `-20260924-pre600x` / `-mcp-20260815` | 3 | 建议留档后删 |
| `package-lock.json`、`servers/mcp-gateway/._.env` | 2 | 可删 |
| **prod 独有源码**（`ai-service/src/agent/agents/bianbian.agent.ts`、`study-assistant.agent.ts`） | 2 | ⚠️ 需确认是否还要 |
| `servers/content-hub/src/app.module.ts.bak-institution-20260826` | 1 | 备份，可删 |

### 1.2 一个会踩的机制细节

`master` **跟踪了 102 个 `servers/gateway/public/*` 文件**，而 prod 上另有 671 个未跟踪产物。
所以若走"原地 init → checkout master"：**凡是进了索引的 prod 独有文件都会被删除**
（包括那 671 个 public 产物，若被 `git add` 进去）。这是方案 B 的主要风险点。

---

## 2 方案对比

### 方案 A：新目录 clone（**推荐**）

```
/data/web_system          ← 旧目录完整保留，不动
/data/web_system_git      ← clone master 的新目录
```

1. clone（prod 无 GitHub 权限时走 bundle，见 §3）
2. 迁移运行时数据：8 份 `.env` → `cp -a`；`servers/gateway/public` → `cp -a`（**保留 671 个未跟踪产物**）；
   `node_modules` → 软链（省 465M 复制）或 `cp -a`
3. 改 `ecosystem.config.js` 的 `cwd` → `/data/web_system_git`
4. `pm2 delete` + `pm2 start ecosystem.config.js`（**有停机**，约每个服务 10-20s）
5. 逐端口探活验证

| | |
|---|---|
| ✅ 优点 | 旧目录完整保留 → **回退 = 改回 cwd 重启，秒级**；绝不误删任何 prod 文件 |
| ❌ 缺点 | node_modules 要处理（软链/复制）；pm2 进程需重建 → 有停机窗口 |

### 方案 B：原地 git init

1. 完整备份（`tar`，排除 `node_modules` 与 `.git`）
2. `git init` + 从 bundle `fetch`
3. **预处理**：把 `gateway/public/**`、`src/**`、各 `pnpm-lock.yaml` 加入 `.git/info/exclude` 并 `git rm -r --cached`，避免 checkout 删除
4. `git checkout master`
5. 重建 12 个服务 dist
6. 补 `INTERNAL_API_KEY`
7. `pm2 restart`（路径不变，无需重建进程）

| | |
|---|---|
| ✅ 优点 | 路径不变、pm2 无需重建、node_modules 原样不动 |
| ❌ 缺点 | checkout 会删进索引的 prod 独有文件（需 §1.2 预处理兜底）；源码被覆盖，回退依赖备份 |

> **结论：推荐方案 A。** 理由不是"A 更快"，而是 A 的失败模式最温和——
> 最坏情况只是把 cwd 改回去，而 B 的失败模式是"源码已被覆盖、要解压备份恢复"。

---

## 3 prod 能否访问 GitHub（决定 clone 方式）

本次尝试：`git bundle` 传 shallow 包过去 → **失败**
（`did not send all necessary objects`，shallow bundle 不被接受）。

可行的两条路：

| 方式 | 说明 |
|---|---|
| ① prod 有 GitHub 权限 | 配 deploy key / 或 `git clone https://...`（需 token），最简单 |
| ② 无权限（用 bundle） | 本地生成**完整** bundle（`--depth 1` 的不行）→ `scp` → `git fetch /tmp/xxx.bundle` |

⚠️ 若走 ②，必须从**完整本地仓库**生成：
`git bundle create /tmp/ws-full.bundle origin/master`（浅包会被拒）。

---

## 4 前置必做（两个方案都要）

| # | 事项 | 为什么 |
|---|---|---|
| P1 | **补 `INTERNAL_API_KEY`**（8 个服务，与 user-service 同值） | prod 全部缺失。拉齐后 `auth-service` 调 `/internal/users/email/verify` 会 401（dev 已踩过）；`user-service` 的 InternalGuard 在 expected 为空时直接抛 401 |
| P2 | 完整备份（排除 node_modules） | 方案 A 的回退是改 cwd，但备份仍是最后保险 |
| P3 | 确认 clone 方式（§3） | 否则卡在第一步 |
| P4 | 确认那 2 个 prod 独有 agent 文件是否还需要 | `bianbian.agent.ts` / `study-assistant.agent.ts`，checkout 后会消失 |

---

## 5 执行风险（必须先知道）

1. **崩溃循环**：gateway restarts 578、ai-service 1002。拉齐后可能好转（老 bug 已修）也可能暴露新问题。
   → **不要一次全量重启**，先拿 `system-service`（restarts=0、依赖最少）试点。
2. **代码跨度极大**：4007 文件差异，prod 是很老的版本。一次性拉齐行为变化太大，
   建议：**先拉齐代码 → 只重启试点服务 → 观察 30 分钟 → 再全量**。
3. **`pm2 restart --update-env` 禁用**（项目规则）：会把执行会话的变量固化进 `pm2_env`。
   prod 的 `NODE_ENV=production` 正是靠 ecosystem 注入的，一旦被污染 → **synchronize 会在 prod 上打开**，后果是服务启动时改表结构。
4. **upload-service 有 dist 无 .env** —— 拉齐后若要启动它，得先补配置（当前 pm2 里没有该进程）。

---

## 6 验证清单（执行后逐条打勾）

- [ ] `git log --oneline -1` 在 prod 上能出结果（不再是 exit 128）
- [ ] `git status --porcelain` 干净（或仅有预期的未跟踪运行时文件）
- [ ] 8 个端口探活全 200：6000-6007
- [ ] `pm2 jlist` 中每个进程 `NODE_ENV=production` 仍在（**没被 `--update-env` 污染**）
- [ ] admin 页面可访问（`gateway/public/admin` 未被误删）
- [ ] `curl` 一个需要 internal 调用的接口，验证 401 已消失

---

## 7 关于本次已在 prod 上做的事（需知会）

为评估差异，已在 prod 执行过（**未改任何业务文件、未重启任何服务**）：

- `git init` + 用临时 excludesFile（排除 `node_modules/` `dist/` `logs/` `.env*`）`git add -A` +
  `git commit -m "prod baseline (eval only)"` → commit `8280bc7`
- 从本地上传的 bundle 做 fetch 尝试（失败，未产生副作用）
- `/tmp/ws-master.bundle`、`/tmp/prod-baseline.bundle`、`/tmp/pe-ignore`

影响：prod 目录多了一个 `.git`（约几 MB，只含源码不含 node_modules/dist/logs/.env）。
**已校验 baseline 内不含敏感文件**（仅 1 个 `servers/mcp-gateway/._.env`，是 163B 的 macOS 元数据，非真 .env）。

- 若采纳方案 B → 这个 `.git` 正好是起点，`8280bc7` 就是回退锚点
- 若采纳方案 A 或想恢复原状 → `rm -rf /data/web_system/.git` 即可，工作区不受影响

---

## 8 待你拍板

| # | 问题 | 建议 |
|---|---|---|
| Q1 | 方案 A（新目录）还是 B（原地）？ | **A** |
| Q2 | prod 有无 GitHub 权限？无的话走完整 bundle（约几十 MB，需 scp） | 需你确认 |
| Q3 | 变更窗口时间（会重启 pm2，有停机） | 待定 |
| Q4 | 那 2 个 prod 独有 agent 文件还要吗？ | 建议先备份再删 |
