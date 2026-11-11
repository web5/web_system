# tests/ — web E2E 唯一入口

web_system 全部**浏览器层** E2E 的唯一入口（Playwright 多 project，根 `pnpm test:e2e` 一条命令见全集）。
本 README 是 runbook 单点真源：七章结构，与小程序线 packages/mp-e2e README 同构（03 方案 §3.3），
换端学习成本归零。用例卡规范见**附录 A**（双端通用 v2.0）。

> 🔴 红线：**禁止再开独立 playwright.config**（`apps/` 下的自治孤岛已随 portal 收敛拆除，
> 03 方案 §1.2 硬伤③）。新前端入口 = 在 `playwright.config.ts` 的 projects 加一行 +
> spec 命名 `<app>.<suite>.spec.ts`。**禁止**在 spec 里硬编码 URL/账号/选择器常量
> （URL 走 `support/env.ts`，账号走 `fixtures/test-accounts.md` 机制）。

## 目录结构

```
tests/
├── playwright.config.ts    多 project 配置（portal / admin / console / mobile-portal / release）
├── global-setup.ts         环境可达性 preflight（FAIL-fast，见 ⑤）
├── e2e/                    前端 E2E 用例
│   ├── portal.smoke.spec.ts     Portal 冒烟（@smoke）
│   ├── admin.smoke.spec.ts      Admin 冒烟（@smoke）
│   ├── console.smoke.spec.ts    Console 冒烟（@smoke）
│   └── portal.todo.spec.ts      Todo 页面功能（@regression，含 CRUD BLOCKED 组）
├── smoke/
│   └── release-smoke.spec.ts    发布后业务链路（@release-smoke，project=release）
├── support/
│   ├── env.ts                   dotenv 加载 + BASE_URL/CONSOLE_URL 单一解析点
│   ├── auth.fixture.ts          登录态复用（伪 token 过客户端守卫 / 真登录两路径）
│   └── static-server.mjs        无后端静态伺服（CI @smoke / 本地轻量验证）
├── api/                    API 契约/链路测试（待补）
├── fixtures/
│   ├── test-accounts.md         测试账号文档真源
│   └── .env.test                （不入库，自建，模板见 test-accounts.md）
└── README.md               本文件
```

## ① Quickstart

```bash
# 一次性：装依赖 + 浏览器
pnpm install
npx playwright install chromium

# 全量（需要本地全栈：local-up + envoy，见 ②）
pnpm test:e2e

# 只跑冒烟（PR 门禁同款，无需后端，Playwright 自起静态伺服）
pnpm --filter @web-system/shared --filter @web-system/types --filter @web-system/ui --filter @web-system/agent-message build
pnpm --filter @web-system/portal exec vite build
pnpm --filter @web-system/admin exec vite build
E2E_WEBSERVER=1 BASE_URL=http://127.0.0.1:8899 pnpm test:e2e --grep @smoke --project=portal --project=admin

# 单 project / 列清单
pnpm test:e2e --project=portal
pnpm test:e2e:list

# 连 dev 环境跑发布后冒烟
BASE_URL=https://dev.kedouai.com pnpm test:e2e --grep @release-smoke
```

## ② 前置条件

| 跑什么 | 需要的环境 |
|---|---|
| `@smoke`（portal/admin） | **无后端**：portal/admin 的 `vite build` 产物 + `E2E_WEBSERVER=1` 静态伺服 |
| `@regression` UI 骨架（portal.todo describe 一/移动端） | 同上（Todo 页面 API 失败有空态兜底） |
| `@regression` CRUD 链路（portal.todo describe 二） | **BLOCKED**：todo-service 真后端 + 真登录态（见 ⑤ W③） |
| console project | deploy-console 本机常驻 `:6200`（断言 `/api/apps` 200\|401） |
| release project / 全量默认入口 | 本地全栈：`bash scripts/local-up.sh`（MySQL/Redis 前置）+ envoy `https://local.kedouai.com` |

环境变量（`support/env.ts` 统一解析，`.env.test` 自动加载，环境变量 > .env.test > 默认）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BASE_URL` | `https://local.kedouai.com` | portal/admin/mobile-portal/release 基地址。⚠️ **勿指 `http://localhost:6000`**：6000 在 Chromium 受限端口清单（ERR_UNSAFE_PORT），浏览器导航必败（W④） |
| `CONSOLE_URL` | `http://localhost:6200` | console 基地址 |
| `E2E_WEBSERVER` | — | `=1` 时 Playwright webServer 自起 `support/static-server.mjs` |
| `TEST_USER_NAME` / `TEST_USER_PASS` | — | 真登录账号（`.env.test`，见 ⑥） |
| `CI` | — | 设为 1 时 retries=2 + forbidOnly + workers=1 + html reporter |

project 一览：

| project | testMatch | 基地址 | 内容 |
|---|---|---|---|
| `portal` | `e2e/portal.*.spec.ts` | BASE_URL | portal 冒烟 + todo 功能 |
| `admin` | `e2e/admin.*.spec.ts` | BASE_URL | admin 冒烟 |
| `console` | `e2e/console.*.spec.ts` | CONSOLE_URL | deploy-console 冒烟 |
| `mobile-portal` | `e2e/portal.mobile.*.spec.ts` | BASE_URL | 移动端门户（待用例） |
| `release` | `smoke/release-smoke.spec.ts` | BASE_URL | 发布后业务链路 |

## ③ 用例契约

- **写新用例先填用例卡**（附录 A 引用《02-测试用例卡规范 v2.0》双端通用版），卡评审通过后按卡的 web 端枚举翻译。
- **文件命名**：`tests/e2e/<app>.<suite>.spec.ts`；suite ∈ `smoke` / `mobile.<suite>` / 功能名（如 `todo`）。命名进 project testMatch 正则，新前缀必须先改 config。
- **标签三级**（写在 describe 标题里，`--grep` 过滤）：

  | 标签 | 语义 | 何时跑 |
  |---|---|---|
  | `@smoke` | 页面能开、资源完整（不验业务链路） | **PR 门禁**（CI quality-gate `e2e-smoke` job） |
  | `@release-smoke` | 关键业务链路 | 发布后，连真实环境 |
  | `@regression` | 功能面 | 按需 / 定时（全量回归工程未立项，见 ⑤ W⑤） |

- **断言纪律**（02 规范 web 端口径）：优先 `expect(locator).toHaveText/...`（Playwright 自带 auto-waiting）；**禁止 `page.waitForTimeout` 硬 sleep 代替等待**（假绿模式，历史存量待清理）；登录态一律走 `support/auth.fixture.ts`（伪 token 仅限「页面零真实 API 依赖」场景，业务链路必须 `loginViaApi` 真登录）。
- **BLOCKED 表达**：`test.fixme(true, '<理由 + 引用的已知限制编号>')`（03 方案 §7：原生语义、reporter 自动单列，不计失败）。先例：`portal.todo.spec.ts` CRUD 组。
- **与 scripts/verify/ 的分工**：`scripts/verify/*.sh` 管秒级发布验收（端口/API/进程，无需浏览器）；`tests/` 管需要浏览器的层。verify 通过是 e2e 的前置。

## ④ exit code 与失败口径

Playwright 原生口径（03 方案 §3.3「统一原则不统一数值」）：

| exit code | 语义 |
|---|---|
| 0 | 全部通过（fixme/BLOCKED 不计失败，skipped 不计失败） |
| 1 | 有用例失败，**或 preflight 环境不可用 FAIL-fast** |

- **preflight（global-setup.ts）**：跑任何用例前，对本次选中 project 依赖的基地址做 TCP 可达性探测（秒级）。不可达 → 抛「E2E 环境不可用」横幅 + 排查提示，exit 1——**不是** N 条用例各自 30s 超时的噪声瀑布（03 方案 §2.4）。
  - 「可达」= TCP 能连上（不管 HTTP 状态码）；浏览器能不能导航该 URL 由用例自身暴露。
  - `--project` 过滤后只探测选中 project 的地址（跑 portal 不因 console 没起而红）。
  - 本地与 CI 同一口径：不可达即 FAIL。web 侧**不引入**小程序线的 REQUIRE_ENV 逃生门——本地有 `E2E_WEBSERVER=1` 静态伺服，「环境不可用」这一类基本可消灭。
- **四态对照**（与小程序线语义对齐）：passed / failed / **fixme=BLOCKED**（显式列出、不计失败）/ skipped。

## ⑤ 已知限制

- **W① 真第三方回调不可测**：微信支付/第三方 OAuth 回调等需真实外部回跳的场景不进本基建，走人工验收。
- **W② 真 LLM 流式依赖转 BLOCKED**：依赖流式响应的交互一律 `test.fixme()` 标 BLOCKED 并引用本条。
- **W③ CRUD 依赖真后端 + 真登录态**：`portal.todo` CRUD 组（todo-service）、以及任何写库链路，在静态伺服/CI @smoke 环境不可测，须 BLOCKED；挂全栈环境的回归属 W⑤。伪 token 只过前端路由守卫，服务端验签必 401。
- **W④ Chromium 受限端口**：`http://localhost:6000`（gateway 直口）在浏览器受限端口清单（ERR_UNSAFE_PORT），BASE_URL 默认走 `https://local.kedouai.com`（envoy→6000）。preflight 用 TCP 探测不受影响。
- **W⑤ 全量回归的后端环境编排未立项**：CI 里起 MySQL + 后端服务跑 `@regression` 全量是独立 M 档工程（03 方案 §2.5），当前 CI 只有 `@smoke` 门禁。
- **W⑥ console project 不进 CI @smoke**：其断言依赖 deploy-console 后端（`/api/apps`），同属 W⑤ 范围；本地/发布后可手动 `--project=console`。

## ⑥ 账号与守卫

- **测试账号**：唯一文档真源 `fixtures/test-accounts.md`；机密值落 `fixtures/.env.test`（不入库，模板在该文档）。`.env.test` 由 `support/env.ts` 自动加载（dotenv）。
- **登录态两条路径**（`support/auth.fixture.ts`）：
  - A · `injectFakeLogin(page)`：伪 JWT（exp 未来）预置 localStorage，只过 portal 客户端路由守卫。**前提：被测页面零真实 API 调用**（如 Todo UI 骨架）。
  - B · `loginViaApi(request)`：真账号走 `/api/auth/login`，业务链路必须用它；缺账号配置时 FAIL-fast 报指引。
- **守卫**：`global-setup.ts` preflight（环境可达性，见 ④）。web 侧 localStorage key 漂移守卫（02 规范 M1 的 web 版）**未实施**，列 follow-up（03 方案 §7：key 消费点分散，误报率需实测）。
- **用例间隔离**：Playwright 每 test 独立 browser context（与小程序线 session.js「每用例独立 launch」语义对齐）。

## ⑦ FAQ

**Q：本地跑 `pnpm test:e2e` 直接红「E2E 环境不可用」？**
A：这是 preflight 在干活。看横幅里的排查提示：全栈 → `local-up.sh`；只想跑前端用例 → `E2E_WEBSERVER=1` 静态伺服路线（① Quickstart）；console → 本机 :6200 没起。

**Q：为什么默认 BASE_URL 不是 `localhost:6000`？**
A：6000 是 Chromium 受限端口（W④），浏览器根本打不开。本地统一走 `https://local.kedouai.com`。

**Q：我想给新页面/新 app 加 e2e？**
A：① 填用例卡（附录 A）→ ② spec 命名 `<app>.<suite>.spec.ts` 落 `tests/e2e/` → ③ 新 app 在 config projects 加一行（🔴 不许新开 config 文件）→ ④ 本地跑绿后提 PR。

**Q：CI 上 @smoke 红了怎么看？**
A：quality-gate `e2e-smoke` job 失败时会上传 `playwright-report-e2e-smoke` artifact（含截图/trace）。本地复现命令见 job 注释与 ①。

**Q：portal 以前的 `apps/portal/e2e/` 和 `todo-playwright-cli.sh` 呢？**
A：已拆除（2026-11-11，03 方案 S2）：spec 收编为 `tests/e2e/portal.todo.spec.ts`，cli 脚本与独立 config 删除。原 spec 断言的是旧内存版 Todo.vue，与现 API 驱动版漂移，处置记录见该文件头注。

**Q：`servers/ai-agent/e2e/` 是什么？**
A：那是 **agent 质量评测（LLM eval）**，不是浏览器 e2e，入口是 `servers/ai-agent` 下的 `pnpm test:eval`（原 `test:e2e` 已改名消歧，03 方案 §7）。与本目录无关。

## 附录 A · 测试用例卡规范

卡片模板、动作/断言枚举（web 端 + 小程序端两节）、SKIP/BLOCKED 口径、假绿模式库、准入/打回纪律，单点真源：
**《02-测试用例卡规范 v2.0（双端通用）》**（任务产物目录 `2026-11-11-小程序E2E测试基建沉淀/02-测试用例卡规范.md`）。

web 端速查（细节以 02 规范 §3.2b/§3.3b 为准）：

| 卡字段 | web 翻译目标 |
|---|---|
| 动作 `goto(url)` | `page.goto(url)`（baseURL 由 config 注入，禁写绝对地址） |
| 动作 `click(selector)` | `page.click` / `locator.click` |
| 动作 `storage.set` | `page.evaluate(localStorage…)` 或 context cookies API |
| 断言 `url` | `expect(page).toHaveURL(...)` |
| 断言 `dom.text/visible/count` | `expect(locator).toHaveText/toBeVisible/toHaveCount`（auto-waiting，替代小程序侧 data.wait/data.now 之分） |
| 断言 `storage.get` | localStorage/cookie 读出断言 |
| 异常分支 BLOCKED | `test.fixme(true, '<理由 + 已知限制编号 W<n>>')` |
| 异常分支 SKIP | 不写——环境不可用由 preflight 统一 FAIL-fast |
