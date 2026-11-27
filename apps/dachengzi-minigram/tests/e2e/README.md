# dachengzi-minigram E2E 用例索引

基建：`@web-system/mp-e2e`（真源见 `packages/mp-e2e/README.md`）。运行：`pnpm test:e2e`。
验收/交付一律用 `pnpm test:e2e:strict`，SKIP 非 0 不算通过；普通 `test:e2e` 仅供本地开发看信号。

| 用例 | 文件 | 判据 | 说明 |
|---|---|---|---|
| A | cases/A-tabs.js | V21 | 三 tab 渲染 + 选中态 |
| B | —（未迁移） | — | **暂缓**：目标页已随 AI 能力整改废弃，重写走用例卡流程单独立项 |
| E | cases/E-radius-persist.js | V42 | 圆角设置持久化（E3 跨进程持久化判 BLOCKED，见基建 README 已知限制①） |
| F | cases/F-clear-cache.js | V45 | 清缓存白名单 |
| G | cases/G-login-gate.js | 台账 9045/9053/9085 | 未登录态首页：只有 login-gate、hero 不渲染、greetingText 空串；G3 静态判据只在 `Page({data})` 块内取值——`loggedIn` 必须是 `isLoggedIn()` 调用，`greetingText` 三元**false 分支必须空串**（实现 `lib/init-state-check.js`，负例矩阵 `tests/init-state-check.test.ts`） |
| I | cases/I-about-version.js | 台账 9060 | 关于页版本号渲染：`.ver` 含 `v{APP_VERSION}`（真源 utils/version.ts），非 `v1.0.0` |
| J | cases/J-hero-layout.js | 台账 9042 | 16 汉字/16 emoji 昵称下 hero 不挤出、不压副标题、emoji 无半截 |

已知限制（automator 选择器边界等）统一记在基建 README `## ⑤ 已知限制`，本仓库不再另立一份。
