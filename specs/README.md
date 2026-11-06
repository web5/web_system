# web_system 规格索引（specs/）

> 本文件由 `node scripts/gen-specs-index.mjs` 生成，**请勿手工编辑**。
> 改完后跑 `npm run specs:index` 重新生成；CI/本地校验用 `npm run specs:index:check`。
> 规范见《规格驱动开发 SDD SOP》；新增 feature 用 `npm run new:spec -- <slug> [--design]`。

## 一图看规模

| 指标 | 数量 |
|---|---|
| feature 总数 | 65 |
| 有 requirements.md | 8 |
| 有 design.md | 45 |
| 仅 api-design | 11 |
| 仅 page-spec | 5 |
| 仅原型 | 3 |
| 仅 inventory | 1 |
| 空目录 | 0 |
| 文件总数 | 118 |

> 「文件总数」口径：`specs/<feature>/` 下递归的 `.md` 文件数（不含 `.sdd-baseline.json`、`prototype.html`、`.sql` 等非 md 产物）。

## 按形态分组

> 形态判定与 `scripts/audit-specs.mjs` 同源（`scripts/lib/spec-rules.mjs`），不另立口径。

### 有 design（45）

| Feature | 状态 | 文件 | 最后更新 |
|---|---|---|---|
| [`agent-message-extract`](./agent-message-extract/) | 方案设计中 | design.md · page-spec.md | 2026-11-06 |
| [`app-artifact-env-dir`](./app-artifact-env-dir/) | 待评审 | design.md | 2026-11-06 |
| [`auto-deliver`](./auto-deliver/) | 已实现 | 2026-09-30-upload-logger/requirements.md · 2026-09-30-upload-logger/design.md | 2026-11-06 |
| [`backend-consolidation`](./backend-consolidation/) | 实施中 | a8-ai-image-store/design.md · design.md · page-spec-storage-config.md | 2026-11-06 |
| [`backend-health-endpoint`](./backend-health-endpoint/) | 已实现 | design.md | 2026-11-06 |
| [`ci-cd`](./ci-cd/) | 已评审确认 | design.md · tech-design-gh-actions-release.md | 2026-11-06 |
| [`config-driven-deploy`](./config-driven-deploy/) | 待评审 | design.md | 2026-11-06 |
| [`config-master-key-distribution`](./config-master-key-distribution/) | 已实现 | design.md · guide.md | 2026-11-06 |
| [`conversation-source-filter`](./conversation-source-filter/) | 已评审确认 | design.md | 2026-11-06 |
| [`deploy-console`](./deploy-console/) | 待评审 | design.md · tasks.md · api-design.md … +7 | 2026-11-06 |
| [`deploy-console-domain-split`](./deploy-console-domain-split/) | 已评审确认 | requirements.md · design.md · inventory-cleanup-01.md … +6 | 2026-11-06 |
| [`deploy-console-env-datasource`](./deploy-console-env-datasource/) | 草稿 | design.md | 2026-11-06 |
| [`deploy-console-wecom-approval`](./deploy-console-wecom-approval/) | 实施中 | design.md · decision.md · tech-design-network-and-sequence.md | 2026-11-06 |
| [`design-reviewer`](./design-reviewer/) | 待评审 | design.md | 2026-11-06 |
| [`dict-module`](./dict-module/) | 实施中 | design.md · api-design.md · page-spec.md … +1 | 2026-11-06 |
| [`from-zero-bootstrap`](./from-zero-bootstrap/) | 已实现 | requirements.md · design.md | 2026-11-06 |
| [`glossary-collect`](./glossary-collect/) | 实施中 | design.md | 2026-11-06 |
| [`iam-multi-system`](./iam-multi-system/) | 待评审 | requirements.md · design.md | 2026-11-06 |
| [`kedou-ai-minigram`](./kedou-ai-minigram/) | 已实现 | requirements.md · design.md · page-spec-chat-en-style.md … +2 | 2026-11-06 |
| [`kit-sop-enforcement`](./kit-sop-enforcement/) | 已实现 | design.md | 2026-11-06 |
| [`llm-models-unify`](./llm-models-unify/) | 待评审 | design.md · page-spec.md | 2026-11-06 |
| [`module-env-ownership`](./module-env-ownership/) | 已实现 | design.md · api-design.md | 2026-11-06 |
| [`mp-platform`](./mp-platform/) | 待评审 | design.md · api-design.md | 2026-11-06 |
| [`music-recommend`](./music-recommend/) | 待评审 | requirements.md · design.md · page-spec.md | 2026-11-06 |
| [`pipeline-concurrency`](./pipeline-concurrency/) | 待评审 | requirements.md · design.md | 2026-11-06 |
| [`pipeline-env-branch`](./pipeline-env-branch/) | 已归档 | design.md | 2026-11-06 |
| [`pipeline-env-scripts`](./pipeline-env-scripts/) | 已归档 | design.md | 2026-11-06 |
| [`pipeline-flow-color`](./pipeline-flow-color/) | 待评审 | design.md | 2026-11-06 |
| [`pipeline-node-model`](./pipeline-node-model/) | 已评审确认 | design.md · api-design.md · P0-handoff.md … +3 | 2026-11-06 |
| [`pipeline-release-config`](./pipeline-release-config/) | 已实现 | design.md | 2026-11-06 |
| [`pipeline-restart-verify-as-action`](./pipeline-restart-verify-as-action/) | 待评审 | design.md | 2026-11-06 |
| [`pipeline-step-branch`](./pipeline-step-branch/) | 已实现 | design.md | 2026-11-06 |
| [`pipeline-step-task`](./pipeline-step-task/) | 已实现 | design.md | 2026-11-06 |
| [`pipeline-task-status`](./pipeline-task-status/) | 待评审 | design.md | 2026-11-06 |
| [`pipeline-wires-util`](./pipeline-wires-util/) | 方案设计中 | design.md | 2026-11-06 |
| [`portal-redesign`](./portal-redesign/) | 待评审 | design.md · page-spec.md | 2026-11-06 |
| [`rd-process-model`](./rd-process-model/) | 待评审 | design.md · progress.md | 2026-11-06 |
| [`release-platform`](./release-platform/) | 已实现 | requirements.md · design.md · page-spec-v5-nodes.md … +1 | 2026-11-06 |
| [`remote-backend-release`](./remote-backend-release/) | 已实现 | design.md | 2026-11-06 |
| [`remote-mf-pointer`](./remote-mf-pointer/) | 待评审 | design.md | 2026-11-06 |
| [`service-config-delivery`](./service-config-delivery/) | 已实现 | design.md · tech-design-internal-key-delivery.md | 2026-11-06 |
| [`static-cdn-phase2`](./static-cdn-phase2/) | 已实现 | design.md · tech-design-sync-boundary.md | 2026-11-06 |
| [`tts-continuity`](./tts-continuity/) | 待评审 | design.md · page-spec-tts-disabled.md | 2026-11-06 |
| [`user-memory`](./user-memory/) | 待评审 | design.md | 2026-11-06 |
| [`version-deploy`](./version-deploy/) | 待评审 | design.md · page-spec.md | 2026-11-06 |

### 纯 api-design（11）

| Feature | 状态 | 文件 | 最后更新 |
|---|---|---|---|
| [`ai-agent`](./ai-agent/) | （未声明） | api-design.md | 2026-10-29 |
| [`ai-service`](./ai-service/) | （未声明） | api-design.md | 2026-10-29 |
| [`auth-service`](./auth-service/) | （未声明） | api-design.md | 2026-10-29 |
| [`content-hub`](./content-hub/) | （未声明） | api-design.md | 2026-10-29 |
| [`gateway`](./gateway/) | （未声明） | api-design.md | 2026-10-29 |
| [`knowledge-service`](./knowledge-service/) | （未声明） | api-design.md | 2026-10-29 |
| [`mcp-gateway`](./mcp-gateway/) | （未声明） | api-design.md | 2026-10-29 |
| [`system-service`](./system-service/) | （未声明） | api-design.md | 2026-10-29 |
| [`todo-service`](./todo-service/) | （未声明） | api-design.md | 2026-10-29 |
| [`upload-service`](./upload-service/) | （未声明） | api-design.md | 2026-10-29 |
| [`user-service`](./user-service/) | （未声明） | api-design.md | 2026-10-29 |

### 纯 page-spec（5）

| Feature | 状态 | 文件 | 最后更新 |
|---|---|---|---|
| [`content-cover-media`](./content-cover-media/) | （未声明） | page-spec.md | 2026-10-29 |
| [`content-cron-validation`](./content-cron-validation/) | （未声明） | page-spec.md | 2026-11-06 |
| [`content-preview-typography`](./content-preview-typography/) | （未声明） | page-spec.md | 2026-10-29 |
| [`radius-style-dual`](./radius-style-dual/) | （未声明） | page-spec-legacy-convergence.md · page-spec-pref-sync.md · page-spec.md | 2026-11-06 |
| [`shell-login-handoff`](./shell-login-handoff/) | （未声明） | page-spec.md | 2026-10-29 |

### 纯原型（3）

| Feature | 状态 | 文件 | 最后更新 |
|---|---|---|---|
| [`pipeline-form-preview`](./pipeline-form-preview/) | （未声明） | （无 md） | 2026-10-29 |
| [`popconfirm-width`](./popconfirm-width/) | （未声明） | （无 md） | 2026-10-29 |
| [`sider-submenu-spacing`](./sider-submenu-spacing/) | （未声明） | （无 md） | 2026-10-29 |

### 纯 inventory（1）

| Feature | 状态 | 文件 | 最后更新 |
|---|---|---|---|
| [`ui-prototype-token-alignment`](./ui-prototype-token-alignment/) | ⚠️ 原值：待负责人确认 | inventory-impact.md | 2026-11-06 |

### 空目录（0）

（无）

## R8 章节欠账（notice，不阻断）

| Feature | 缺什么 |
|---|---|
| `auto-deliver` | 变更日志 |
| `iam-multi-system` | 边界与反例 |
| `kedou-ai-minigram` | 变更日志 |
| `music-recommend` | 边界与反例、变更日志 |
| `pipeline-concurrency` | 变更日志 |
| `release-platform` | 边界与反例、变更日志 |

> 判定与 `npm run check:specs` 同源：只统计已具备可验判据章节的 requirements.md；缺「边界与反例」「变更日志」不阻断提交。
