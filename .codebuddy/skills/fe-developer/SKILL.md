---
name: fe-developer
description: web_system 前端开发技能 — admin 系（deploy-console/admin/mcp-admin）页面/UI/交互任务的标准执行方式。触发：新页面、页面大改、样式调整、交互修改、antd 覆盖。
version: 1.0.0
---

# web_system 前端开发（fe-developer）

## 职责

把 UI 任务按 web_system 规范落地：类型判定 → 规格书确认 → 编码 → 自检 → （微前端产物四步）。通用前端工程质量按 `fe-dev-common`（ai-agent-kit `references/fe-dev-common.md`）执行，本卡只写 web_system 特有部分。

## 触发条件

- 新页面 / 布局级大改 / 样式调整 / 交互修改（deploy-console / admin / mcp-admin / 未来内部工具）
- 不适用：portal / mini-app（品牌端 DR-5，Claymorphism，走 `docs/ui/ui-design-spec.html`，不套本卡）

## 工作流

1. **判类型 + 读规范**：判定页面类型（列表/详情/表单/仪表盘/例外，参照页见 `docs/ui/design.md` §1）；按 `docs/ui/README.md` §2 任务×最小文档集取读，**不全目录翻读**。
2. **填规格书**：新页面 `page-spec-template.md` Full / 小改 Quick。
3. **用户确认**：规格书先交用户确认，**确认后才写码**（禁止跳过直接实现）。
4. **编码**：`docs/ui/design.md` 布局铁律（§2）/ 交互状态矩阵（§3）/ 视觉 Token 约束（§4）；antd 覆盖冲突走 `css-override-rules.md`；改色/加色走 `color-reference.md`。
5. **自检（证据化）**：design.md §5——页面类型一致 / 无裸色 / 无新增 !important / dark 过目 / 状态矩阵全覆盖 / 截图基线到 `docs/ui/baselines/`（命名 `{app}-{page}-{before|after}.png`）/ 修正记录追加 `geist-token-评审记录.md`（只追加）。
6. **规则整改执行门**：≥2 文件/跨页面/跨端的批量整改 → 先出《整改影响清单》交负责人确认，再动代码（R6 教训）。
7. **微前端产物四步**（admin/portal/mcp-admin 改动后，否则等于没改）：构建（`RELEASE_TAG=$V MF_FORMAT=system npx vite build --mode mf`）→ 拷贝 `dist/*` 到 gateway `static/modules/<module>/<V>/` → 更新 `web_system_deploy.deploy_deployments`（不是 web_system 库！）→ 等 gateway TTL（10s）验证 `__manifest__`。详见 CODEBUDDY 微前端铁律与 `docs/development/admin-dev.md` §一·C。

## 覆盖核对（已有资产 ↔ 通用规则）

| 通用规则（fe-dev-common §二） | web_system 落点 | 状态 |
|---|---|---|
| 颜色语义化 / 样式覆盖 / 图标 | CODEBUDDY 最小禁项 + design.md §4 + color-reference | 已覆盖（项目优先） |
| 交互状态矩阵 | design.md §3 | 已覆盖 |
| 类型安全 / 组件状态 | CODEBUDDY 开发规则（TS strict） | 已覆盖 |
| 前端安全（XSS/敏感信息） | 无专项文档 | **按通用层补充** |
| 性能（懒加载/列表 key/包体积） | 无专项文档 | **按通用层补充** |
| 可访问性 | 无专项文档 | **按通用层补充** |
| 请求竞态/超时/拦截器 | CODEBUDDY 超时分层（shared） | 部分覆盖，细则按通用层 |
| 测试 | 无强制前端测试门 | 按通用层（任务涉及时） |

## 不做什么

- 不跳过规格书与用户确认；不写裸 hex/rgba、不新增 `!important`、不用 emoji 图标、不互斥单选 ≤5 用 `a-select`。
- 不把 `docs/ui/` 数值/细则复制进业务代码（只引 `--ws-*` / `uiTokens`）。
- 不套本规范到品牌端（portal/mini-app）。
- 微前端改动不执行"四步"不宣布完成。

## 参考文档

| 文档 | 何时加载 |
|------|---------|
| CODEBUDDY.md「UI 页面生成铁律 + 最小禁项 + 微前端四步」 | 任何 UI 任务（常驻） |
| `docs/ui/README.md`（读取地图）→ design.md / page-spec-template / color-reference / css-override-rules | 按任务类型（§2 最小集） |
| `docs/ui/geist-token-评审记录.md` | 完成自检回流 |
| fe-dev-common（ai-agent-kit `references/fe-dev-common.md`） | 通用工程质量规则 |
