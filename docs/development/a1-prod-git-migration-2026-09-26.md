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
| P1 | ~~补 `INTERNAL_API_KEY`~~ **经执行核实：不需要**（见 §9.1 事实修正） | prod 的该键**本就存在**于根 `.env.production:73`，由 ecosystem 统一注入所有服务；此前"全部缺失"的结论是只 grep 了 `servers/*/.env` 造成的误判 |
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

## 8 拍板结果（2026-09-26 晚）

| # | 问题 | 结论 |
|---|---|---|
| Q1 | 方案 A / B | **A（新目录 clone）** |
| Q2 | prod 有无 GitHub 权限 | public 仓库，**公有读可用**（`git ls-remote` 实测通） |
| Q3 | 变更窗口 | 当晚执行 |
| Q4 | 那 2 个 prod 独有 agent 文件 | **不保留** |

---

## 9 执行结果（2026-09-26 21:0x–22:0x 实测）

### 9.1 事实修正：INTERNAL_API_KEY 不是缺失

| 位置 | 值 |
|---|---|
| 根 `.env.production:73` | `kedou_internal_26c6a9ba579e6c40c0d91afa7b6efdd4` ← **唯一真相源** |
| `pm2_env` 注入 | 同上（ecosystem 加载根 `.env.production`） |
| `servers/*/.env` | 原来没有；执行中误加过一份后被**清除** |

教训：判断"配置缺失"时必须查**全部加载源**（根 `.env.production` / ecosystem / 服务 `.env`）。
dotenv **不覆盖**已存在的 `process.env` → 源优先级是 `pm2_env > 服务 .env`。

验证（user-service:6002）：
`POST /internal/keys/verify` 无 key = **401**、错 key = **401**、正确 key = **200** ✅

### 9.2 最终状态

| 项 | 结果 |
|---|---|
| prod git 仓库 | ✅ `/data/web_system_git`，`git log` 可用，HEAD `658d3ec` |
| 远程 | `origin = https://github.com/web5/web_system.git` |
| 8 个服务 | 全部 `online`，`cwd=/data/web_system_git`，`NODE_ENV=production`，**restarts=0** |
| 端口 6000–6007 | **全部 200**（`/health`） |
| admin 页面 | `/admin/` = 200 |
| pm2 | 已 `pm2 save`（dump.pm2 落新 cwd，重启机器后不回退） |
| 备份 | `/data/backup/web_system-20260926-2107.tar.gz`（94M，排除 node_modules/.git） |
| 回退路径 | 旧目录 `/data/web_system` 完整保留 → 改 cwd 重启即可，秒级 |

### 9.3 git 工作区

- tracked 脏：**0 个**（L1 已于 2026-09-26 22:1x 解决，见 §12）
- 未跟踪：264 项（`servers/gateway/public/**` 产物、`dist/`、`node_modules/`、`logs/`、`.env*`）
- `git pull --ff-only` **实测成功**，`HEAD=060997f` 与本地 master 一致

---

## 10 踩坑清单（全部实测，下次直接照抄）

| # | 坑 | 现象 | 解法 |
|---|---|---|---|
| 1 | GitHub clone 太慢 | `--depth 1` 跑 6 分钟只下 4.5M | 改**本地 `git bundle` 上传**：`git bundle create f.bundle master`（21M）→ scp **8 秒** → `git clone --branch master f.bundle` |
| 2 | bundle 无 HEAD | `remote HEAD refers to nonexistent ref` | 必须用 `git bundle create f.bundle master`（带 `refs/heads/master`）+ `git clone --branch master`；用 `origin/master` 会生成 `refs/remotes/origin/master` 同样不可用 |
| 3 | `pkill -f 'xxx'` 自杀 | ssh 命令行本身含该串 → exit 255 | 用字符类：`pkill -f 'git-remote-ht[t]ps'` |
| 4 | 脚本退出码误判 | `cmd \| tail` 后取 `$?` 拿到的是 tail 的码 | 用 `${PIPESTATUS[0]}`，或改为检查产物是否生成 |
| 5 | **`.pnpm` 里是旧包快照** | `Cannot find module .../dist/cjs/index.js`；shared 的 `Public` 为 `undefined` | pnpm 对 workspace 包在 `.pnpm` 存**副本**而非链接，复制旧 node_modules 会带过来 → 必须 `pnpm install` 重建 |
| 6 | pnpm 11 默认只装根项目 | `pnpm install` 后 `@web-system/*` 全部消失 | 必须用 **`pnpm install -r`** |
| 7 | 共享包缺 `reflect-metadata` | install 后 8 个服务**全挂** | 根 node_modules 被重建为只剩根依赖；给 `packages/*/node_modules` 补 `reflect-metadata` 软链 |
| 8 | 包构建不是裸 `tsc` | `types` 需要 `dist/cjs` 双构建 | 一律用各包自己的 `npm run build` |
| 9 | **影子测试环境差异** | 7xxx 端口手启 node 报 DB 失败，误判为代码问题 | 手启必须 `set -a; . ./.env.production; set +a`（pm2 会加载它）。实测 gateway/mcp-gateway/user-service 补上后**全部 200** |
| 10 | DI 多实例 | `Nest can't resolve dependencies ... HttpAdapterHost/ModuleRef/Reflector` | 第三方 Nest 包与服务的 `@nestjs/core` 不是同一份 → `pnpm install -r` 修复 |

### 10.1 推荐验证手法：影子启动

改端口（7xxx）+ `NODE_ENV=production` + 加载根 `.env.production`，**不占用线上 600x**，
可在不停机前提下确认新目录能否起。本次靠它避免了第三次全量回退。

---

## 11 遗留项（A1 之后）

| # | 事项 | 说明 |
|---|---|---|
| ~~L1~~ | ~~`public/index.html` tracked 脏阻碍 pull~~ | **已解决**（2026-09-26 22:1x）——静态资源外置，见 §12。`git pull` 实测通过 |
| L2 | admin / portal 前端产物未重建 | 当前用的是旧目录复制来的构建产物（能用，但版本旧）。需在 prod 上 `pnpm -r --filter @web-system/admin build` 等；重建后产物应投到**外置目录** `/data/web_system_static/public`，不再写回仓库 |
| L3 | 升版后 `restarts` 观察 | 切换后全为 0（切换前 gateway 578 / ai-service 1002），需观察 24h |
| L4 | `upload-service` 有 dist 无 .env | 未启动（与切换前一致） |
| L5 | A2 统一 pm2 命名 / A4 补 4 个服务 | 后续轨道 A 任务 |
| L6 | `NODE_ENV=production` 由 ecosystem 注入 | 全程**未使用** `pm2 restart --update-env`（项目规则禁），已核验 `pm2_env.NODE_ENV` 未被污染 |
| L7 | 仓库仍 tracked 102 个 `servers/gateway/public/**` 构建产物 | 当前不阻碍 pull（工作区已干净）。建议 `git rm --cached` + 补 `.gitignore`，见 §12.2 |

---

## 12 静态资源外置：L1 的解法（2026-09-26 22:1x）

### 12.1 事实修正：那个脏文件不是"旧产物"

| | git 里的版本 | prod 上的版本 |
|---|---|---|
| `servers/gateway/public/index.html` | `<title>管理后台</title>`，引 `/assets/index-D48lIXi9.js` | `<title>科豆AI</title>`（官网首页） |

**两者根本不是同一个东西** —— prod 根路径 `/` 的业务页面就是它，不是待废弃的旧产物。
而 `/admin/` 走的是 `public/admin/index.html`，该文件 **untracked**，压根不受 `git pull` 影响。

→ L1 的真实范围只有 **1 个 tracked 文件**，不是之前担心的 102 个。

### 12.2 解法：用代码里已预留的 `STATIC_PUBLIC_ROOT`

这不是 hack，是 2026-09-20（P2）就实现好的能力：

```ts
// servers/gateway/src/static/public-root.ts
export const PUBLIC_ROOT = process.env.STATIC_PUBLIC_ROOT || join(__dirname, '..', '..', 'public');
```

`ServeStaticModule.forRoot({ rootPath: PUBLIC_ROOT })` 与 `IndexHtmlService.readHtml`
（`join(PUBLIC_ROOT, pub, 'index.html')`）都读它。

⚠️ 唯一漏网的：`main.ts:29` 的 `sendIndex` **兜底分支**仍硬编码 `join(__dirname,'..','public',pub,'index.html')`
—— 只在 `render()` 抛异常时才走，建议后续也改成 `PUBLIC_ROOT`。

### 12.3 执行步骤（全程零线上暴露）

| # | 动作 | 结果 |
|---|---|---|
| 1 | `cp -a servers/gateway/public → /data/web_system_static/public` | 36M |
| 2 | 备份 `public/index.html` → `/data/backup/prod-public-index-portal.html` | 回退保底 |
| 3 | `servers/gateway/.env` 追加 `STATIC_PUBLIC_ROOT=/data/web_system_static/public` | gateway **只**加载 `../.env.generated` + `../.env`（`app.module.ts:42`）；根 `.env.production` 是 ecosystem 注入的，不是 gateway 自己读 |
| 4 | **影子验证**：7010 端口 + `NODE_ENV=production` + 该 env | `/` title=科豆AI、`/admin/`=200 → 生效 |
| 5 | `pm2 restart gateway`（**未**用 `--update-env`） | 线上 `/`=科豆AI、`/admin/`=200、`/health`=200 |
| 6 | `git checkout -- servers/gateway/public/index.html` | 线上 `/` **仍是科豆AI** → 证明走外置；tracked 脏=0 |
| 7 | `git pull --ff-only` | **Fast-forward 到 `060997f`**，tracked 脏仍为 0 |

### 12.4 收益

- 发布流水线第一个节点（pull）**畅通**，不再需要 force / 先 `checkout -- .`
- 前端产物与仓库解耦：今后重建产物投**外置目录**，不会再弄脏工作区
- 回退简单：删掉 `STATIC_PUBLIC_ROOT` 重启即回仓库 public；portal 首页另有备份

### 12.5 建议（需 PR，本次未做）

1. **把 102 个 tracked 构建产物移出 git**：`git rm --cached servers/gateway/public/assets/**` 等，
   补 `.gitignore`；保留 `favicon.svg` / `materials/` / 验证 `*.txt` / `fathers-day.html` 等真正的静态资产。
   不清理不影响当前 pull（已干净），但只要有人本地 build 后提交就会重新引入脏文件。
2. **`main.ts:29` 兜底路径改用 `PUBLIC_ROOT`**，否则外置后该分支会指向空目录。
