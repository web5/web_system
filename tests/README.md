# tests/ — 统一 E2E 与发布冒烟

web_system 前后端统一的 Playwright E2E 测试入口。发布后跑冒烟，开发时跑全量。

## 目录结构

```
tests/
├── playwright.config.ts    多 project 配置（portal / admin / console / mobile-portal）
├── e2e/                    前端 E2E 测试
│   ├── portal.smoke.spec.ts     Portal 冒烟（@smoke）
│   ├── admin.smoke.spec.ts      Admin 冒烟（@smoke）
│   └── console.smoke.spec.ts    Console 冒烟（@smoke）
├── smoke/                  发布后业务冒烟
│   └── release-smoke.spec.ts    关键路径闭环（@release-smoke）
├── api/                    API 契约/链路测试（待补）
├── fixtures/               测试账号与种子数据
│   ├── test-accounts.md
│   └── .env.test                （不入库，自建）
└── README.md               本文件
```

## 快速开始

```bash
# 1. 安装依赖（根目录）
pnpm add -D @playwright/test
npx playwright install chromium

# 2. 跑冒烟（本地，默认连 localhost:6000）
npx playwright test --config tests/playwright.config.ts --grep @smoke

# 3. 跑发布后冒烟（连 dev）
BASE_URL=https://dev.kedouai.com npx playwright test --config tests/playwright.config.ts --grep @release-smoke

# 4. 跑单个 project
npx playwright test --config tests/playwright.config.ts --project=portal

# 5. 跑全部
npx playwright test --config tests/playwright.config.ts
```

## Project 说明

| project | testMatch | 默认 baseURL | 说明 |
|---|---|---|---|
| `portal` | `portal.*.spec.ts` | `http://localhost:6000` | 门户前端 |
| `admin` | `admin.*.spec.ts` | `http://localhost:6000` | 管理后台 |
| `console` | `console.*.spec.ts` | `http://localhost:6200` | deploy-console |
| `mobile-portal` | `portal.mobile.*.spec.ts` | `http://localhost:6000` | 移动端门户 |

## 测试标签

| 标签 | 用途 | 何时跑 |
|---|---|---|
| `@smoke` | 前端冒烟（页面加载、资源完整） | 发布后、PR |
| `@release-smoke` | 业务冒烟（登录→首页→API 链路） | 发布后 |

```bash
# 只跑冒烟
npx playwright test --grep @smoke

# 只跑发布后冒烟
npx playwright test --grep @release-smoke
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `BASE_URL` | `http://localhost:6000` | 门户/admin 基地址 |
| `CONSOLE_URL` | `http://localhost:6200` | Console 基地址 |
| `CI` | — | 设为 1 时启用 retries + forbidOnly |

## 与 scripts/verify/ 的分工

| 层 | 谁做 | 覆盖 |
|---|---|---|
| 发布验收（Bash） | `scripts/verify/*.sh` | 端口/API/进程/manifest（秒级，无需浏览器） |
| E2E 冒烟（Playwright） | `tests/e2e/` + `tests/smoke/` | 页面加载、资源完整、业务链路（需要浏览器） |

**推荐流程**：发布 → `scripts/verify/` 秒级验收 → `tests/` Playwright 冒烟 → 报告完成。
