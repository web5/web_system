# Web System 优化路线图

> 生成时间：2026-08-28
> 基于项目全量代码审查，按优先级排序。每个任务可独立拆分派发。
> 验收标准用于完成后自检。

---

## P0 — 安全与仓库卫生（立即处理，低风险高回报）

### T0-1 生产环境配置移出版本库

- **问题**：`apps/admin/.env.production` 被 git 跟踪。当前内容仅含 IP 地址，但 `.gitignore` 的 `**/.env*` 对已跟踪文件不生效，未来一旦加入 API Key 即直接泄露。
- **执行**：
  1. `git rm --cached apps/admin/.env.production`
  2. 确认 `.gitignore` 中 `**/.env*` 规则覆盖该文件
  3. 如生产环境需要该文件，通过部署脚本或服务器环境变量注入
- **验收**：`git ls-files | grep .env.production` 无输出；本地文件仍存在但不被跟踪。
- **预估**：10 分钟
- **依赖**：无

### T0-2 网关构建产物移出版本库 + 素材目录收敛

- **问题**：`servers/gateway/public/assets/`（102 个 Vite 哈希构建产物）、`index.html` 被提交进 git；`materials/svg/` 与构建产物目录中的素材重复。
- **执行**：见下方「附录 A：gateway public 目录迁移方案」
- **验收**：
  - `git ls-files servers/gateway/public/assets/` 无输出
  - `git ls-files servers/gateway/public/index.html` 无输出
  - `site-assets/` 下所有源素材被跟踪
  - 本地构建 + 部署后页面正常访问
- **预估**：30 分钟
- **依赖**：无

### T0-3 引入 CI 流水线

- **问题**：无 `.github/workflows`，11 个后端 + 5 个前端完全靠人工提交，lint / 类型检查 / 密钥扫描 / 测试均无门禁。
- **执行**：
  1. 创建 `.github/workflows/ci.yml`，触发条件：push 到 master + PR
  2. 步骤：`pnpm install` → 各服务 `type-check` → `lint` → 密钥扫描（gitleaks 或简单 grep）→ 有测试的服务跑 `test`
  3. 配置 master 分支保护（需仓库管理员）
- **验收**：PR 页面显示 CI 状态；故意提交一个类型错误能被 CI 拦截。
- **预估**：2-3 小时
- **依赖**：无

### T0-4 清理子目录残留的 package-lock.json

- **问题**：`apps/mini-app`、`apps/deploy-console`、`servers/system-service`、`servers/todo-service`、`servers/deploy-console` 子目录残留 npm 的 `package-lock.json`，在 pnpm workspace 中混用 npm 会破坏依赖一致性。
- **执行**：
  1. `git rm` 上述 5 个 `package-lock.json`
  2. 在根 `package.json` 加 `"packageManager": "pnpm@9.15.0"` 和 `engines` 字段
  3. 可选：加 `preinstall` 脚本检测包管理器
- **验收**：`find . -name package-lock.json -not -path '*/node_modules/*'` 无输出；`pnpm install` 正常。
- **预估**：15 分钟
- **依赖**：无

---

## P1 — 架构收敛（短期，1-2 周）

### T1-1 收敛 ai-service 与 ai-agent 的 agent 定义管理

- **问题**：两个服务职责重叠且代码正在漂移：
  - `ai-service/src/agent-def/`（完整 controller/service/entities 模块）
  - `ai-service/src/agent/agent-def-sync.service.ts`
  - `ai-agent/src/agent/agent-def-sync.service.ts`（与 ai-service 版本内容不一致）
  - 当前未提交改动还在同时往两个服务加 `agent-def-sync`
- **执行**：
  1. 明确边界：ai-agent = 独立 agent 运行时（OCR / 合同风控 / 流式输出）；ai-service = 业务 AI 服务（对话 / 生图 / 变变）
  2. agent 定义的 CRUD + 同步逻辑收敛到一处（建议 `@kedou/agent-core` 包，或 ai-agent 服务作为唯一 owner，ai-service 通过内部 API 调用）
  3. 删除重复文件，消除双份源码漂移
- **验收**：`agent-def` 相关代码只存在于一个位置；两个服务启动正常；agent 定义列表 / 同步功能可用。
- **预估**：1-2 天
- **依赖**：无（建议优先于 T1-2）

### T1-2 网关代理路由表配置化

- **问题**：`servers/gateway/src/proxy/proxy.service.ts` 手写 15+ 个 proxy 实例，新增/调整服务都要改代码重新部署；默认端口散落（6001-6010 与 README 的 3000-3005 不符）。
- **执行**：
  1. 提取路由表为配置（JSON/YAML 或环境变量），格式：`{ path, target, timeout, pathRewrite }`
  2. 网关启动时按配置动态注册 proxy 中间件
  3. 统一端口分配文档（见 T3-1）
- **验收**：新增一个服务只需改配置文件 + 重启网关，无需改 TS 代码；现有所有路由行为不变。
- **预估**：半天
- **依赖**：T3-1（端口统一）建议同步进行

### T1-3 统一 PM2 配置，消除双文件漂移

- **问题**：`ecosystem.config.js`（生产，读 `/data/web_system/.env.production`）与 `ecosystem.config.cjs`（本地）并存，职责不同但容易误用。
- **执行**：
  1. 合并为单一 `ecosystem.config.cjs`，通过 `NODE_ENV` 或参数区分本地/生产
  2. 或保留两个文件但在文件头明确标注用途，并在 `package.json` scripts 中固定引用（如 `pm2:local`、`pm2:prod`）
  3. 清理 `ecosystem.config.js` 中与实际服务不符的条目
- **验收**：`pm2 start ecosystem.config.cjs` 本地可启动全部 11 个服务；生产部署文档引用唯一配置文件。
- **预估**：1 小时
- **依赖**：无

### T1-4 Docker Compose 补齐与架构对齐

- **问题**：`docker-compose.yml` 仅 7 个服务、`docker-compose.prod.yml` 仅 5 个，实际有 11 个服务，缺少 ai-agent / mcp-gateway / content-hub / upload / deploy-console 等。
- **执行**：
  1. 确认哪些服务需要容器化部署（可能部分服务仅本地开发用）
  2. 补齐 `docker-compose.yml`（本地开发用，含 postgres/redis）
  3. 补齐 `docker-compose.prod.yml`（生产用，不含 DB，连接外部 DB）
  4. 或明确标注「生产使用 PM2 而非 Docker」，删除过时的 compose 文件
- **验收**：`docker-compose up -d` 可启动完整本地环境；或文档明确说明生产部署方式与 compose 文件的关系。
- **预估**：半天
- **依赖**：无

---

## P2 — 工程质量（中期，2-4 周）

### T2-1 核心服务补测试

- **问题**：测试几乎为零：
  - 后端 11 个服务中仅 ai-service / auth-service / mcp-gateway 各 1 个测试文件
  - gateway / ai-agent / user-service / todo-service 等核心服务零测试
  - 前端 5 个应用中仅 mini-app（3 个）、portal（1 个）有测试
- **执行**（按优先级）：
  1. gateway：代理路由转发 + 错误处理的集成测试（mock 上游）
  2. auth-service：登录 / JWT 签发 / 权限校验的单元 + 集成测试
  3. ai-agent：agent 定义同步 + 流式输出的测试
  4. user-service：用户 CRUD 的集成测试
  5. 前端 admin：关键页面（登录 / 用户列表）的组件测试
- **验收**：上述服务 `pnpm test` 可运行且通过率 100%；CI 中包含测试步骤。
- **预估**：3-5 天（分批进行）
- **依赖**：T0-3（CI）先建好

### T2-2 统一工程规范（ESLint / tsconfig / Prettier / Husky）

- **问题**：根目录无统一配置，各子项目自配且版本漂移：ant-design-vue 4.0~4.2.6、axios 1.6~1.7.9、pinia 2.1~3.0、vue 3.4~3.5 并存。
- **执行**：
  1. 根目录建 `eslint.config.js`（flat config）、`tsconfig.base.json`、`.prettierrc`
  2. 各子项目 extends 根配置
  3. 加 Husky + lint-staged，提交前自动 lint + format
  4. 用 pnpm catalog 或 `overrides` 统一核心依赖版本（vue / ant-design-vue / axios / pinia）
- **验收**：`pnpm lint` 在根目录可递归检查所有项目；提交时自动格式化；核心依赖版本一致。
- **预估**：1 天
- **依赖**：无

### T2-3 分支策略与提交卫生

- **问题**：5 个并行 feature 分支（contract-risk-ai / ai-agent-harness / wechat-mp-skills-optimize / agent-harness-and-deploy-scripts）都基于 master 分叉，master 无保护；当前分支有大量未提交改动。
- **执行**：
  1. 提交当前工作区改动（或 stash）
  2. 合并已完成的 feature 分支到 master，删除过时分支
  3. 制定分支策略：master（保护）→ develop（集成）→ feature/*
  4. 约定 commit message 格式（Conventional Commits）
- **验收**：`git branch` 仅保留活跃分支；master 受保护；PR 必须通过 CI 才能合并。
- **预估**：半天
- **依赖**：T0-3（CI）

### T2-4 静态资源去重

- **问题**：`apps/admin/public/avatars/` 与 `apps/portal/public/avatars/` 各放一份 1.1MB 默认头像；gateway public 中素材与构建产物目录重复。
- **执行**：
  1. 默认头像收敛到 `packages/shared/assets/` 或 `apps/portal/public/`（作为唯一源），其他应用构建时引用
  2. T0-2 已处理 gateway 素材重复
- **验收**：仓库中默认头像仅一份源文件；构建产物中可有多份（正常）。
- **预估**：30 分钟
- **依赖**：T0-2

---

## P3 — 文档与配置（持续）

### T3-1 重写 README，对齐实际架构

- **问题**：README 严重过时：描述 6 个后端服务（实际 11 个）、apps 含 admin-web（实际 admin）、端口表 3000-3005（实际 proxy 默认 6001-6010）、未提及 ai-agent / mcp-gateway / content-hub / upload-service / deploy-console。
- **执行**：
  1. 以实际目录结构重写「项目结构」「技术栈」「端口分配」「功能模块」
  2. 更新快速开始步骤（确认所有命令可运行）
  3. 补充微前端 / MCP / AI Agent 架构说明
- **验收**：新人按 README 可在 30 分钟内跑起本地环境；端口表与代码一致。
- **预估**：2 小时
- **依赖**：无

### T3-2 清理过时文档

- **问题**：`docs/` 下 61 篇 md，含 `archive/` 目录，可能存在大量过时文档未清理。
- **执行**：
  1. 逐篇审查 docs/，标记过时 / 重复 / 已迁移
  2. 过时文档移入 `docs/archive/` 或删除
  3. 建 `docs/README.md` 作为文档索引
- **验收**：docs/ 下每篇文档都有明确用途且不过时；索引可导航。
- **预估**：1-2 小时
- **依赖**：无

### T3-3 包命名规范统一

- **问题**：`servers/deploy-console` 包名 `deploy-console-server`，其他均为 `@web-system/*` 前缀。
- **执行**：
  1. 改为 `@web-system/deploy-console`
  2. 全局搜索引用处并更新
- **验收**：所有服务包名均为 `@web-system/*`；`pnpm -r list` 无异常。
- **预估**：30 分钟
- **依赖**：无

### T3-4 端口分配统一与文档化

- **问题**：README 说 3000-3005，proxy 默认 6001-6010，ecosystem cjs 注释说 auth 用 6101（与另一个项目 erp_web_site 冲突）。
- **执行**：
  1. 确定一套端口分配（建议 6000 段，避开常见冲突）
  2. 所有服务的 `.env.example`、proxy 默认值、ecosystem 配置、README 统一
  3. 在 `docs/development/` 建 `port-allocation.md`
- **验收**：全局搜索端口号无矛盾；新服务按文档分配端口。
- **预估**：1 小时
- **依赖**：无

---

## 附录 A：gateway public 目录迁移方案（T0-2 详细步骤）

### 目标结构

```
servers/gateway/public/
├── site-assets/              ← 【受版本控制】源素材
│   ├── README.md
│   ├── svg/                  # 原 materials/svg/
│   ├── favicon.svg
│   ├── html/fathers-day.html
│   ├── logo-proposals/       # 从构建产物抢救
│   └── qrcode/bianbian-qrcode.png
├── 9a3a1872….txt             ← 域名验证（根路径，保留）
├── b4wxUGeuJ9.txt            ← 域名验证
├── assets/                   ← 【gitignore】Vite 构建
├── index.html                ← 【gitignore】Vite 构建
├── shell/                    ← 【gitignore】已有
└── static/                   ← 【gitignore】已有
```

### 执行命令

```bash
cd /Users/geekwen/workspace/web_system/servers/gateway/public

# 1. 建目录
mkdir -p site-assets/svg site-assets/html site-assets/logo-proposals site-assets/qrcode

# 2. 迁移被跟踪的源素材（保留 git 历史）
git mv materials/svg/* site-assets/svg/
git mv favicon.svg site-assets/
git mv fathers-day.html site-assets/html/

# 3. 抢救未被跟踪但有价值的素材
cp -R static/modules/portal/a1f5301/logo-proposals/* site-assets/logo-proposals/
cp static/modules/portal/a1f5301/bianbian-qrcode.png site-assets/qrcode/

# 4. 清理空目录
rmdir materials/svg materials 2>/dev/null

# 5. 从 git 移除构建产物（保留本地文件）
git rm -r --cached assets/ index.html

# 6. 更新 .gitignore（新增以下规则）
# servers/gateway/public/assets/
# servers/gateway/public/index.html
# servers/gateway/public/materials/
# !servers/gateway/public/site-assets/

# 7. 提交
git add site-assets/ .gitignore
git commit -m "refactor(gateway): 收敛 public 目录，源素材移入 site-assets/，构建产物移出版本库"
```

### 注意事项

- 域名验证两个 txt 必须留在根目录（验证方访问根路径），不迁移
- `site-assets/` 由网关 `useStaticAssets` 直接托管，无需改部署脚本
- 构建产物 `assets/`、`index.html` 由 `pnpm build` + `deploy.sh` 重新生成，移除 git 不影响部署
- 迁移后需验证：本地构建 → 部署 → 页面正常访问 / SVG 素材可加载 / favicon 正常

---

## 任务依赖关系图

```
T0-1 (env)     T0-2 (public)   T0-4 (lockfile)
     |               |               |
     +-------+-------+---------------+
             |
          T0-3 (CI)
             |
     +-------+-------+
     |               |
  T2-1 (test)    T2-3 (branch)
     |
  T2-2 (lint)     T1-1 (ai 收敛)
     |               |
     +-------+-------+
             |
          T1-2 (路由配置化) ← T3-4 (端口统一)
             |
          T1-3 (PM2)    T1-4 (Docker)
             |               |
             +-------+-------+
                     |
                  T3-1 (README)
                  T3-2 (文档清理)
                  T3-3 (包命名)
```

---

## 建议执行顺序

1. **第一波（今天）**：T0-1、T0-2、T0-4 —— 纯仓库卫生，10-30 分钟/项，无风险
2. **第二波（本周）**：T0-3（CI）、T1-1（ai 收敛）、T3-1（README）
3. **第三波（下周）**：T2-1（测试，分批）、T2-2（规范）、T1-2（路由配置化）
4. **持续**：T3-2、T3-3、T3-4、T1-3、T1-4、T2-3、T2-4
