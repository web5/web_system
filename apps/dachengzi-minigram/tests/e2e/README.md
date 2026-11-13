# dachengzi-minigram E2E 用例索引

基建：`@web-system/mp-e2e`（真源见 `packages/mp-e2e/README.md`）。运行：`pnpm test:e2e`。

| 用例 | 文件 | 判据 | 说明 |
|---|---|---|---|
| A | cases/A-tabs.js | V21 | 三 tab 渲染 + 选中态 |
| B | —（未迁移） | — | **暂缓**：目标页已随 AI 能力整改废弃，重写走用例卡流程单独立项 |
| E | cases/E-radius-persist.js | V42 | 圆角设置持久化（E3 跨进程持久化判 BLOCKED，见基建 README 已知限制①） |
| F | cases/F-clear-cache.js | V45 | 清缓存白名单 |
