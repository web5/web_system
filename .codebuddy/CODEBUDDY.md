# 科豆 AI · 项目入口

## 是什么

科豆 AI 儿童创造力平台 — 全栈 monorepo（Vue3 + NestJS + PostgreSQL + 微信小程序）。

**平台产品矩阵**：
| 产品 | 定位 | 路由 |
|------|------|------|
| 变变 | AI 拼贴变身 3D 角色 | /create → /transform → /result |
| 画板 | 自由绘画 + AI 文生图 | /draw |
| AI 学习助手 | 少儿 AI 对话 | /chat |

## 技术栈速查

| 层 | 技术 |
|----|------|
| 前端 | Vue3 + Vite + Pinia + Ant Design Vue 4.x |
| 后端 | NestJS 10 + TypeORM 0.3 + PostgreSQL |
| 小程序 | 微信原生 + TypeScript |
| 部署 | Docker Compose + Nginx |

## 端口

| 服务 | 端口 |
|------|------|
| gateway | 6000 |
| auth-service | 6101 |
| user-service | 6002 |
| ai-service | 6003 |
| ai-agent | 6010 |
| system-service | 6004 |
| portal (dev) | 5173 |
| admin-web (dev) | 5174 |
| docs (static) | 4173 |

## 本地启动速查

- **全栈一键**：`./start-local.sh`（安装依赖 + 构建 shared/types + 起 6 服务 + 2 前端），详见 `docs/development/local-dev-setup.md`
- **admin 后台（vite dev）**：`cd apps/admin && pnpm dev` → `http://localhost:5174/admin/`（base 为 `/admin/`）
- **portal（vite dev）**：`cd apps/portal && pnpm dev` → `http://localhost:5173/portal/`（base 为 `/portal/`，URL 必须带 `/portal/` 前缀；微前端模块用 `pnpm build --mode mf`）
- **本地 nginx 集成**：构建前端后 `sudo ~/local/nginx/sbin/nginx` 启动、`-s reload` 重载，访问 `https://local.kedouai.com/admin/`（配置见根目录 `local.nginx.conf`，已被 `conf.d/web_system-local.conf` include）

> ⚠️ **admin 路由 base 是 `/admin/`**：页面 URL 必须带 `/admin/` 前缀（如 `/admin/agents`），不带会 404。admin 详细开发指南（启动/依赖/路由/nginx 集成/Agent 调试）见 `docs/development/admin-dev.md`。

## 本地发布速查（2026-09 迁移后 · 运维手册：`docs/development/local-release-runbook.md`）

> 服务统一从**发布目录** `~/web_system_release` 运行（pm2 `web-*`，dotenv 按 cwd 加载**发布目录**的 `.env`）。
> **发布 = 工作区 commit&push → 发布目录拉取分支 → 构建部署**（基于 git 拉取，不基于当前工作区）。

- **端口**：gateway 6000 / auth 6101 / user 6002 / ai 6003 / system 6004 / todo 6005 / mcp-gateway 6006 / content-hub 6007 / upload 6008 / ai-agent 6010 / deploy-console 6200
- **发布方式**：
  - 后端服务 + admin/portal 前端 → **发布流水线**：`POST /api/pipelines`（deploy-console 6200，env=local，branch=feature/xxx），轮询 jobId 至 succeeded
  - **deploy-console 自身 → 传统发布**（发布目录构建 dist + `pm2 restart web-deploy-console`），**勿走流水线**（stageRestart 会 restart 执行者，自杀式中断）
  - 前端产物投递 `servers/gateway/public/static/modules/<key>/<version>/`，验证 manifest（等 gateway TTL 10s）
- **Hook（DB 真相源，规避 CodeBuddy 删除审批）**：content-hub/upload-service/ai-agent（build）、admin/portal（build+upload+cleanup）已注册——构建/投递前 `mv` 旧产物到 `/tmp`。改 hook：控制台「模块详情→发布脚本」或 `PUT /api/modules/:key/hooks/:stage`
- **关键坑**：
  - 后台进程批量删除 **≥500 文件** 被 CodeBuddy 安全层拦截（后台无确认通道，报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`）→ 用 hook `mv` 方案，勿改 IDE 阈值（无效）
  - pnpm install 中断残留 `*_tmp_*` 目录（tsc 报 `TS2688 node_tmp_xxx`）→ `mv` 到 `/tmp` 清理，缺失包从工作区 `cp -R` 补齐
  - `pm2 --update-env` 会传播 pm2 记录的旧环境变量（如 PORT 污染，dotenv 不覆盖）→ 干净 env `start` + `pm2 save`

## 设计常量

**平台（暗色）**：主色 `#f97316` 暖橙 / 暗底 `#0A0A0D` / 文字 `#F8FAFC`
**变变产品（暖色）**：主色 `#FF8C42` 魔法橙 / 底色 `#FFF8F0` 暖白 / 文字 `#333333`

> ⚠️ **admin 系（deploy-console/admin/mcp-admin）UI 数值以 `packages/ui/src/tokens.ts` 为准**（DR-3 主橙 #F97316，平台段），变变品牌色只用于 portal/mini-app。改 UI 前必走下方「UI 页面生成铁律」。

## UI 页面生成铁律（admin 系 · 每个 UI 任务强制）

> 细则本体在 `docs/ui/`（单事实源，**入口 = `docs/ui/README.md` 读取地图**），规则 `.codebuddy/rules/ui-interface/` 负责触发。收到任何 UI 任务（新页面/改版/调样式/改交互）按此执行：

1. 读 `docs/ui/README.md`（读取地图，按任务类型定位最小集）→ 新页面必读 `docs/ui/design.md`（判断层）
2. 按 `docs/ui/page-spec-template.md` 填**页面规格书**（新页 Full / 小改 Quick）
3. **规格书先给用户确认，确认后才写码**——禁止跳过直接实现
4. 改色/加色 → 读 `docs/ui/color-reference.md`；覆盖冲突/"改了不生效" → 读 `docs/ui/css-override-rules.md`
5. 完成后自检（design.md §5：无裸色/无新增 !important/dark 过目/截图基线），修正记录追加 `docs/ui/geist-token-评审记录.md`（只追加）

**最小禁项**：禁裸 hex/rgba（只引 `--ws-*`）；禁新增 `!important`；禁 emoji 图标；互斥单选 ≤5 固定选项禁 `a-select`（用 tabs/radio）；主操作 primary ≤1；破坏性操作必二次确认；portal/mini-app 品牌端不套用本规范（DR-5）。

## 开发规则

1. 大改动走 Superpowers 工作流：brainstorm → plan → execute → review
2. 架构决策前加载 `tech-review` 审查
3. 不主动 git commit
4. TypeScript 严格模式，禁止 `any`
5. 每个微服务独立数据库
6. 所有 API 通过 gateway 代理
7. **Icon 规范**：禁止使用 emoji 作为图标，统一使用 SVG icon；如果没有合适的 SVG icon，宁可不用 icon
8. **静态资源路径**：
   - `/api/uploads/*` — 用户上传文件和 AI 生成图片的统一路径（头像、变变图、画板等）
   - `/materials/svg/*` — 系统素材 SVG，独立于页面路由，由 Gateway 直接提供
   - AI 生成图片必须落盘到 `/api/uploads/` 目录 + 数据库存相对路径，不能只存远程 URL

## AI 编程规范

这些规则从真实踩坑中提炼，旨在提高 AI 编码的「一次正确率」，减少事后补救。

### 安全铁律（每次改动必查）

| 规则 | 正确做法 | 错误做法 |
|------|---------|---------|
| CORS | `configService.get('CORS_ORIGINS', '')`，禁止 `origin: '*'` 或无参 `enableCors()` | 硬编码 `*` 或空参调用 |
| 异常消息 | 生产环境非 HttpException → `'服务器内部错误'` | 直接返回 `exception.message` |
| 输入校验 | 所有 @Body/@Query 用 class-validator DTO | `Record<string, string>` 裸类型 |
| 日志 | `new Logger('xxx').log(...)` | `console.log/error(...)` |
| JWT_SECRET | 每个服务 main.ts/AppModule 启动时校验非空 | 空字符串不报错 |
| .env 密钥 | .env 文件加安全警告注释，密钥走环境变量注入 | 真实密钥明文暴露在文件中 |
| 异常过滤器 | 每个微服务 main.ts 必须有全局异常过滤器 | 未处理异常直接暴露客户端 |
| .env.example | CORS_ORIGINS 写具体域名，不写 `*` | 给开发者错误示范 |

### 代码质量铁律

| 规则 | 正确做法 | 错误做法 |
|------|---------|---------|
| TS 严格模式 | `"strict": true` + `"strictPropertyInitialization": false` | 手选 subset 且 noImplicitAny: false |
| JWT 校验 | 前端路由守卫校验 `exp` 过期 | 只检查 token 是否存在 |
| 401 拦截器 | 竞态锁 + 60s 超时重置 + refreshToken 自动刷新 | 无锁或锁永不重置 |
| 404/403 | 所有前端必须配置 404 + 403 页面 | 权限失败跳 /dashboard |
| @types 版本 | 与运行时包主版本一致，放 devDependencies | @types/node@22 配 node:20，@types/helmet 放 dependencies |
| 无用依赖 | 每个依赖都被源码 import，定期清理 | package.json 残留僵尸包 |
| 变量初始化 | `let flag: boolean = false` | `let flag: boolean`（undefined） |

### 部署铁律

| 规则 | 正确做法 | 错误做法 |
|------|---------|---------|
| PM2 | `pm2 restart xxx \|\| pm2 start ...` | `pm2 delete; pm2 start` |
| Docker | .dockerignore + 每个服务 healthcheck + 敏感端口仅内网 | 无 .dockerignore，端口全开，无健康检查 |
| 生产 Redis | `127.0.0.1:6379:6379` | `6379:6379`（公网暴露） |
| 脚本路径 | `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"` | `dirname "$0"` 相对路径 |

> ⚠️ **微前端页面模块更新铁律**：`admin` / `portal` / `mcp-admin` 都是微前端子模块，由 gateway `__manifest__` 决定加载版本。
> **改完前端源码后必须「构建 → 拷贝 → 更新版本表 → 验证/清缓存」四步才生效**，否则浏览器仍加载旧产物。
> 以 admin 为例（`<module>` 换 portal/mcp-admin 同理）：
> ```bash
> cd apps/admin && V=$(git -C ../.. rev-parse --short HEAD)
> RELEASE_TAG=$V MF_FORMAT=system npx vite build --mode mf
> mkdir -p ../gateway/public/static/modules/admin/$V && cp -r dist/* ../gateway/public/static/modules/admin/$V/
> # ⚠️ 版本表在 web_system_deploy 库（不是 web_system！），gateway 独立数据源连它
> #    UPDATE web_system_deploy.deploy_deployments SET current_version='$V' WHERE env_id='dev' AND module_key='admin'
> sleep 12   # gateway TTL 10s 版本缓存；仍旧则 pm2 restart web-gateway 清内存缓存
> curl -s localhost:6000/__manifest__   # 确认 admin version=$V
> ```
> 两个最容易踩的坑：① 版本表在 **web_system_deploy** 库（写错库 manifest 不变）；② gateway 有 **TTL 10s 版本缓存**（改完要等/重启 gateway）。
> 详见 `docs/development/admin-dev.md` §一·C。改完页面不执行这四步，等同于没改。

> ⚠️ **提交 & 提 PR 铁律**（用户要求提交时执行）：
> - **只 add 本次工作文件**：工作区常有无关未提交文件（`known-issues.md`、`optimization-roadmap.md` 等），用 `git add <具体文件>` 精确暂存，别混入。
> - **token**：GitHub PAT 已存在根 `.env` 的 `GITHUB_PR_TOKEN`（不进 git）。读取：`export GH_TOKEN=$(grep '^GITHUB_PR_TOKEN=' .env | cut -d= -f2-)`。
> - **提 PR 到 master**：`gh` 已装用 `gh pr create --base master --head <分支> ...`；未装则用 GitHub API（`curl -X POST https://api.github.com/repos/web5/web_system/pulls`，`Authorization: Bearer $GH_TOKEN`）。临时 json 用完即删，token 不明文写入可提交文件。
> - 详见 `docs/development/admin-dev.md` §五。

> 完整版：`.codebuddy/references/coding-best-practices.md`  
> 审计报告：`docs/archive/todo-list/audit-report-2026-07-26.md`

### 1. 同类修改必须扫全量（Monorepo 铁律）

修改前必须 `grep` 所有同类文件，不能只改遇到的一个服务。

**真实教训**：之前修了 gateway/auth/todo 三个服务的 CORS 默认值、异常过滤器、console.log→Logger，但 ai-service 仍硬编码 `origin: '*'`，system/user/upload 仍 `enableCors()` 无参。因为这些服务没有被"刚好触及"。

**自查清单（修改任何横切关注点时）**：
- CORS 配置 → `grep -r enableCors servers/*/src` 确认全部从环境变量读取
- 异常过滤器 → `grep -r useGlobalFilters servers/*/src` 确认全部注册
- console.log → `grep -r 'console\.' servers/*/src` 确认无残留
- JWT_SECRET 校验 → 每个用 JWT 的服务 app.module.ts 或有 auth.guard 的都要

### 2. 跨端配置禁止拷贝，必须收口到 `@web-system/shared`

- 先在 `packages/shared/src/` 下新建或追加
- 如需导出，在 `packages/shared/src/index.ts` 中 re-export
- 删掉各端本地的拷贝文件，防止后续开发者误用旧文件

### 2. 请求超时分三层，排查时逐层定位

monorepo 中一次 HTTP 请求经过三层各自独立的超时配置：

| 层 | 位置 | 典型值 |
|----|------|--------|
| 前端 axios / wx.request | `import { API_TIMEOUT } from '@web-system/shared'` | DEFAULT 10s/30s, AI_TASK 180s |
| Gateway http-proxy-middleware | `servers/gateway/src/proxy/proxy.service.ts` 的 `PROXY_TIMEOUT` | DEFAULT 30s, AI_TASK 180s |
| 后端 service 调第三方 | `servers/*/src/common/http/*.client.ts` | 30s |

真实请求超时以 **三层中最短的那层** 为准。遇到「已取消」、504、或 ERR_ABORTED 时，从最内层往外排查，而不是只看某一层。

**Gateway 层也是瓶颈**：新增 AI 类路由（`/api/ai/*`、`/api/bianbian/*`）时，必须在 `proxy.service.ts` 中给对应 proxy 传 `PROXY_TIMEOUT.AI_TASK`，否则会被 30s 默认值截断。

### 3. AI 异步接口不能与 CRUD 共用默认超时

调用第三方 AI 模型的接口（对话 `/ai/chat`、生图 `/ai/image/submit` 等）链路长，冷启动 + 队列等待经常 10-30s，必须单独设置 `API_TIMEOUT.AI_TASK`（90s），不能依赖全局 10s 默认值。

### 4. 新增魔法数字前先全局搜索

写任何硬编码的数字或字符串前，先搜索项目是否已有同类配置或常量。避免以下后果：
- 同类重复配置导致各端行为不一致
- 修改时只改了一处，其他地方仍是旧值

### 5. 收口后清理冗余文件

配置从分散改统一后，必须删除各端的旧配置文件，并确认没有任何地方仍然 import 旧路径。

### 6. 前端项目加入共享包依赖

portal / mini-app 如需引用 `@web-system/shared`：
- `package.json` 加 `"@web-system/shared": "file:../../packages/shared"`
- 小程序额外需要在 `tsconfig.json` 中配置 `paths` 映射
- 执行 `pnpm install` 使符号链接生效

**后端 service 添加方式不同**：
- `package.json` 加 `"@web-system/shared": "file:../../packages/shared"`
- **不要在 tsconfig.json 中加 paths 映射**（pnpm workspace 的符号链接已处理模块解析）
- 加 paths 会导致 `nest build` 把 `packages/shared/src/` 源文件也编译进 dist，产生错误的目录结构
- 执行 `pnpm install` + `pnpm build` 即可

## Skills

| Skill | 何时用 |
|-------|--------|
| `rd-digital-agent` | 入口 Hub，自动路由 |
| `rd-brainstorm` | 模糊需求，出方案选项 |
| `rd-plan` | 细化方案，拆任务 |
| `rd-execute` | TDD 逐项实现 |
| `rd-review` | 完成后自检 |
| `tech-review` | 架构/安全/数据方案审查 |
| `user-memory` | 用户偏好自动加载 |
