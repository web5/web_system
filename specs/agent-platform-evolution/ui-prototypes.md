# Agent 平台演进 · UI 原型稿（Page Spec 全量 v1）

> 日期：2026-09-08 ｜ 归属：`specs/agent-platform-evolution/`（配套 design.md D6）
> 规范：遵循 `docs/ui/design.md`（类型判定/布局/交互/视觉）+ `page-spec-template.md`。
> 用法：写码前逐页按本规格执行；本文件即页面功能原型。如需要可点击交互稿（`prototype-scaffold.html` 骨架）另行说明。
> 编号规则：1-2 仪表盘类 / 3-4 P2 / 5-6 P3 / 7-8 P4 / 9 横切。实现一律走 token（`--ws-*` / `uiTokens`），禁裸 hex/emoji/新 `!important`；主色橙 `brand`，语义用 success/error/warning。

---

## 1. 观测台（P2 · 新页面）

- 页面类型：仪表盘/监控
- 参照页：`Dashboard.vue`（KPI+图表骨架）＋ deploy-console `ServiceManager.vue`（信息密度 canonical）
- 需求一句话：让运营一眼看到各 agent 的 run 量/成功率/成本/延迟趋势，并钻取到单次 run

### 页头
- 标题：Agent 观测
- 副标题：运行量、成功率、token 成本与延迟趋势
- 主操作：无

### 模块清单
| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 | 备注 |
|---|---|---|---|---|---|
| 1 | 时间/维度筛选条 | 日期范围 + agent + model + source | `a-radio-group`(今日/7日/30日) + 两个 `a-select` | — | source 只两值可用 a-radio-group 或 select（≥2 项） |
| 2 | KPI 卡行 | `run_metrics` 聚合 API | 4 卡：run 总量/成功率/总成本/平均延迟 | 显示 `--` | 数字列 `tabular-nums` |
| 3 | 趋势图区 | 聚合按日序列 | 成功量/失败量柱状 + 成本/延迟折线（chart 用 brand 单主色 + 语义辅色） | 图空 → 提示调整筛选 | 类型枚举不配色 |
| 4 | 明细下钻表 | run 聚合列表（agent/model/source/量/错/成本） | 表格，行点击跳 Run 详情 | "当前筛选无数据，放宽时间范围" | 分页 |

### 交互清单
| 操作 | 触发 | 反馈 | 破坏性确认 | 完成后动作 |
|---|---|---|---|---|
| 切换筛选 | radio/select | loading | 无 | 重查 2/3/4 |
| 下钻 | 行点击 | 无 | 无 | 跳 `/agents/runs/:runId` |

### 状态自查：加载/空态/失败可重试（刷新）覆盖；无破坏性/禁用态适用；图数据失败 toast + 重试按钮
### 风险/待澄清：图表库与现有 Dashboard 用同款（避免新引）；`run_metrics` 聚合 API 形态以 D3.3 为准

---

## 2. 平台总览 Dashboard（P4 收尾 · 扩展首页）

- 页面类型：仪表盘/监控（对 admin 首页 `/dashboard` 的扩展，非新后台）
- 参照页：admin `Dashboard.vue`（保持首页既有信息架构，追加 Agent 区）
- 需求一句话：把 agent/知识/评测三块的健康与成本汇到首页，运营不用逐页进

### 模块清单（追加到现有首页）
| 序 | 模块 | 来源 | 承载 | 空态 | 备注 |
|---|---|---|---|---|---|
| 1 | Agent 平台状态卡 | run_metrics + agent_definitions | 小卡行：启用 agent 数/今日 run/成功率/今日成本 | `--` | 主卡点击进观测台 |
| 2 | 预警/待办列表 | eval 门禁失败、知识解析失败、无单价记录 | 列表 | "暂无待处理" | 标题行"待办" |

### 交互清单
- 卡行点击 → 跳对应域（观测台/知识/评测）；待办项点击 → 对应详情；破坏性操作无（仅跳转）
### 状态自查：跳转无状态矩阵负担；待办空态必须有"暂无待处理"
### 风险/待澄清：首页是否允许加行需与首页现有 owner 核对，避免破坏现有布局（进实现前确认）

---

## 3. run 详情增强（P2 · 小改）

- 页面/组件：`AgentRunDetail`（admin /agents runs 详情，回放时间线已有）
- 类型与参照：不变（详情页）
- 改动内容：概览卡字段补齐——`agentVersion`(版本徽标 ws-mono)、`model`、token(输入/输出/总, tabular-nums)、`cost`、`durationMs`(已有则并入)、`source`；时间线事件若已含 usage 则展示
- 涉及 Token：`--ws-mono` / `tabular-nums`；版本徽标用中性底色（`--ws-bg-hover` 或 Tag 默认）
- 交互影响：无新增状态；空 usage 显示 `--` 而非 0（区分"未记账"）

## 4. 模型单价配置（P2 · 新页面，低频管理）

- 页面类型：列表/管理页（低频配置）
- 参照页：admin `UserList.vue` 页头架构；表格密度参照 `ServiceManager.vue`
- 需求一句话：运营维护各 provider/model 每千 token 单价，供成本核算

### 页头：标题"模型单价"；副标题"输入/输出每 1K token 价格，影响成本统计"；主操作"新建单价"
### 模块清单
| 序 | 模块 | 来源 | 承载 | 空态 |
|---|---|---|---|---|
| 1 | 列表 | model_pricing API | 表：provider/model/输入价/输出价/币种/更新人/更新时间/操作 | "暂无单价配置，先新建再产生成本" |
| 2 | 编辑表单 | 弹窗（provider+model 必填，价格 number） | 新建/编辑同表单 | — |
### 列展示规则：价格 `tabular-nums` 保留 4 位小数；provider/model `ws-mono`
### 交互清单
| 操作 | 反馈 | 破坏性确认 | 完成后 |
|---|---|---|---|
| 新建/保存 | success/error toast；saving 锁 | 无 | 刷新列表 |
| 删除 | success/error | Modal.confirm"删除后历史成本将按 0 计，需重配" | 刷新 |
### 风险：价格字段需与成本计算口径一致（D3.3 的 pricing 键：provider+model 唯一）

---

## 5. 知识集合管理（P3 · 新页面）

- 页面类型：列表/管理页（集合 → 抽屉管理文档与授权）
- 参照页：`ServiceManager.vue`（集合列表）+ `ModuleDetail.vue`（抽屉文档区形态）
- 需求一句话：运营维护知识集合、文档入库状态、授权给哪些 agent

### 页头
- 标题：知识集合；副标题：文档知识库，供 agent 经 MCP 工具检索
- 主操作："新建集合"

### 模块清单
| 序 | 模块 | 来源 | 承载 | 空态 |
|---|---|---|---|---|
| 1 | 集合列表 | knowledge_collections API | 表：名称/文档数/启用/授权 agent 数/创建时间/操作(管理|删除) | "暂无知识集合，点右上新建" |
| 2 | 文档子面板 | 抽屉内：knowledge_docs | 文档表：标题/来源/状态(parsing\|ready\|failed)/分块数/上传时间/操作(删除) + 上传入口 | "暂无文档，上传一份 docx/pdf/txt/md" |
| 3 | 授权配置 | 抽屉内：agent 多选 | 勾选已发布 agent | 无 agent 时提示先建 agent |

### 交互清单
| 操作 | 反馈 | 破坏性确认 | 完成后 |
|---|---|---|---|
| 新建/编辑集合 | toast；保存锁 | 无 | 刷新 |
| 上传文档 | 上传后状态 parsing，轮询/手动刷新变 ready/failed | 无 | 文档表刷新 |
| 删除文档/集合 | toast | Modal.confirm：文档"删除后不可恢复"；集合"级联删除全部文档与分块" | 刷新 |
| 授权保存 | toast | 无 | 刷新 |
### 状态自查：上传异步需 loading + 状态列实时（failed 行给 tooltip 错误摘要）；禁用态=停用集合上传按钮 tooltip"启用后可用"
### 风险：文档解析是异步 job（MCP jobId 轮询语义，D4.3）；支持格式列表与 ai-service OCR 无重叠确认

## 6. 检索调试器（P3 · 新页面，工具型）

- 页面类型：判定为工具/调试页，参照现有 `AgentPlayground`（admin 已有同族调试形态，SSE/分栏时间线）
- 需求一句话：开发者/运营验证一个 query 在授权集合内的召回质量，调 topK/embedding 参数

### 页头：标题"检索调试"；副标题"验证 knowledge_search 召回，无需跑完整 agent"
### 模块清单
| 序 | 模块 | 来源 | 承载 |
|---|---|---|---|
| 1 | 输入区 | 选择集合 + topK 输入 + query 文本框 | 执行按钮（primary ≤1） |
| 2 | 结果列表 | knowledge_search API（内部直调，不经 MCP 也可） | 命中项：分块预览/score/来源文档/序号 |
| 3 | 元信息 | 返回：耗时 ms、召回数 | 行内展示 `tabular-nums` |
### 交互清单：执行→loading；失败 toast+可重试；空召回→"无命中，试降低 topK 或换表述/检查文档已 ready"；预览块可展开全文
### 状态自查：仅展示无破坏性；score 精度 4 位
### 风险：需 service 提供非 MCP 直调端点（内部 RPC），避免为调试开 MCP 副作用

---

## 7. 评测台（P4 · 新页面）

- 页面类型：列表/管理页（数据集 → 用例编辑器 → 报告 diff 三级）
- 参照页：`ServiceManager.vue`（数据集列表）+ 报告对比参考现有 run diff 展示形态
- 需求一句话：运营/开发者维护评测用例、跑批、看相对已发布版本的得分 diff，作为发布门禁依据

### 页头
- 标题：Agent 评测；副标题：数据集与回归报告，发布前自动跑 smoke
- 主操作："新建数据集"

### 模块清单
| 序 | 模块 | 来源 | 承载 | 空态 |
|---|---|---|---|---|
| 1 | 数据集列表 | eval_datasets | 表：名称/agent/用例数/最近跑批/平均分/操作 | "暂无数据集，先为某个 agent 建一个" |
| 2 | 用例编辑器 | eval_cases | 弹窗/抽屉：input + 判据配置(程序化断言/LM-judge rubric 维度) + 标签 | — |
| 3 | 跑批入口 | eval_runs | 行内"跑评测"按钮（smoke/全量选择） | — |
| 4 | 报告视图 | eval_results | 概览：通过率/分项均分 + 基线 diff(↗↘)；明细表 | "跑批后生成" |
### 交互清单
| 操作 | 反馈 | 破坏性确认 | 完成后 |
|---|---|---|---|
| 新建/编辑用例与数据集 | toast | 无 | 刷新 |
| 跑评测 | 按钮 loading，轮询任务状态（jobId 语义） | 无 | 结果写入报告视图 |
| 删除数据集 | toast | Modal.confirm"删除将连同用例与历史结果一起移除" | 刷新 |
| 坏例回收 | run 详情页入口 | 无 | 跳评测台预填用例 |
### 状态自查：跑批是异步长任务须 loading+可查状态；无判据配置的用例保存时提示将仅记录不改分；报告 tabular-nums
### 风险：LLM-judge 成本/抖动（同 case 复跑允许 diff 上限）；rubric 维度配置项以 D5.2 为准

## 8. 发布门禁呈现（P4 · 集成改动）

- 页面/组件：Agent 定义管理发布流程（`AgentDefList` 发布动作）
- 改动内容：发布弹窗内先展示"smoke 集"最近跑批摘要；提交后若被门禁拦截，弹窗切换为 diff 报告（拦原因+各用例 fail 明细+基线↗↘）；未配 smoke 集时展示提示"无评测门禁，将直接发布（建议先建数据集）"，用户仍可发布
- 涉及 Token：语义色（success/error/warning）仅编码状态；fail 明细行 `ws-mono`/tabular-nums
- 交互影响：新增"门禁拦截"状态；拦截不算失败 toast，展示报告为主

## 9. 权限点接线（横切 · Quick）

- 改动：`@web-system/types` PERMISSIONS 增 `knowledge:view/manage`、`agents:eval`、`agents:cost:view`；user-service 角色授予同步；admin 菜单/路由 meta 与 `v-has-perm` 挂点（观测台 `agents:view`；成本列 `agents:cost:view`；单价页 `agents:cost:view`；知识页 `knowledge:view/manage`；评测台 `agents:eval`）
- 无独立页面；403 由现有守卫覆盖；风险：角色默认授予需回退兼容一期 editor/viewer（不降权存量）

---

## 10. 能力资产总览（P2 · 新页面，只读聚合）

- 页面类型：列表页（聚合只读，零写操作）
- 参照页：`ServiceManager.vue`（表格密度）＋ `UserList.vue`（页头形态）
- 需求一句话：在一个页面看清某 agent 挂载的全部能力（本地工具/MCP 工具/技能/知识集合）与来源、状态，并跳回各模块管理

### 页头
- 标题：能力资产
- 副标题：按 agent 汇总挂载的能力（只读聚合，编辑请回到各模块）
- 主操作：无（只读页）

### 模块清单
| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 |
|---|---|---|---|---|
| 1 | agent 选择 | 已发布 agent 列表 | `a-select`（选项动态） | — |
| 2 | 四类能力概览卡 | 聚合 API | 4 卡：本地工具/MCP 工具/技能/知识集合（含数量） | 数量 0 显示 0 |
| 3 | 能力明细表 | 聚合 API | 表格：类型/名称/来源/状态/更新时间/操作 | "该 agent 未挂载任何能力，去定义管理配置 capabilities" |
| 4 | 分区错误态 | 聚合 API 子源失败 | 错误块 + 重试 | — |

### 列清单
| 列 | 来源字段 | 展示规则 | 操作 |
|---|---|---|---|
| 类型 | type | tag（tool/mcp/skill/knowledge 仅用 tag，不做类型配色） | — |
| 名称 | name | `ws-mono` | — |
| 来源 | source | `ws-mono`：代码注册 / mcp-gateway / ai-service 技能库 / knowledge-service | — |
| 状态 | status | 语义 tag：启用/停用/未授权 | — |
| 更新时间 | updatedAt | `tabular-nums` | — |
| 操作 | — | 跳转按钮；无目标模块权限时 disabled + tooltip"需要 xxx 权限" | 跳 /mcp、/agents/skills、/agents/knowledge |

### 交互清单
| 操作 | 触发 | 反馈 | 破坏性确认 | 完成后 |
|---|---|---|---|---|
| 切换 agent | select | loading | 无 | 重查卡片与表格 |
| 跳转模块 | 按钮 | 无 | 无 | 目标模块页（无权限则 disabled+tooltip） |
| 重试 | 分区内按钮 | 重试聚合 | 无 | 分区刷新 |

### 状态自查
- [x] 加载中 [x] 空态（原因+出路）[x] 失败可重试（分区级）[x] 无破坏性操作（只读）[x] 禁用有 tooltip [x] 无弹窗套弹窗
### 风险/待澄清
- 聚合 API 归属 ai-service（D6.6），前端不扇出直连 mcp-gateway
- 未授权知识集合是否在此页显示（当前：显示并标"未授权"，便于运营发现缺口）

---

## 与 admin 现有框架整合（整合版 v3 原型的依据）

> 依据 2026-09-08 对 `apps/admin` 的实地勘察。本节是**实现落点的事实源**，覆盖上述页面规格中的路由/权限/Token 表述。

### 1. 真实框架事实（不可想当然）
| 项 | 真实情况 | 文件 |
|---|---|---|
| 路由 | `createWebHistory('/admin/')`；页面级 `meta: { title, permission }`；`agents` 为纯分组路由 | `apps/admin/src/router/index.ts` |
| 菜单 | **硬编码**（非路由生成、非配置）：`a-menu` + 唯一 `a-sub-menu`（Agents）；图标用 `@ant-design/icons-vue` | `apps/admin/src/layouts/BasicLayout.vue` |
| 布局 | sider 220（折叠 80）+ logo「科豆 AI」；header 56（面包屑两级 + 主题切换 + 用户下拉）；content margin 16；footer 品牌/链接 | 同上 |
| 主题 | `document.documentElement[data-theme]` + `antdTheme(mode)` 注入 `a-config-provider`；默认 light | `stores/theme.ts`、`App.vue` |
| 权限 | 路由守卫**只读本地 `ROLE_PERMISSIONS` 常量**（非后端下发）；菜单用 `userStore.hasPermission`；`v-has-perm` 已注册但 0 处使用 | `router/index.ts`、`packages/types` |
| 表格 | `a-table` + `#bodyCell` 插槽 + `a-tag :color` 状态 + `pagination` computed | `views/Agents/AgentRuns.vue` |
| 空/错/加载 | **无公共组件**：`a-empty` / `a-spin`·`:loading` / `message.error`（`api/request.ts` 已按状态码兜底）；admin 未用 `a-skeleton` | 各视图 |

### 2. Token 修正（覆盖前面页面的表述）
- 页面一律使用 **`--ws-*`**（`packages/ui/src/tokens.css` 事实源），**不使用**原型早期自造的 `--primary/--card/--text`。
- 常用：`--ws-brand-500`、`--ws-bg-page`、`--ws-bg-surface`、`--ws-bg-subtle`、`--ws-bg-hover`、`--ws-text-primary/secondary/tertiary`、`--ws-border`、`--ws-border-subtle`、`--ws-success-500/100`、`--ws-warning-*`、`--ws-error-*`、`--ws-radius-*`、`--ws-space-*`、`--ws-shadow-card`。
- 数字列/ID/路径用现成类 **`.ws-mono`**（已含 `tabular-nums`）；卡片可用 `.ws-hairline`。
- 状态标签沿用现状 `<a-tag :color>`（antd 预设色名）；若要统一语义色再引入 `.ws-tag-*` 并**同步 `tokens.ts` + `tokens.css`（light/dark）**后跑 `scripts/check-tokens-sync.mjs`。

### 3. 页面落点映射（路由 / 菜单 / 权限）
| 页面 | 路由 | 菜单位置 | 权限点 | 备注 |
|---|---|---|---|---|
| 能力资产总览 | `/agents/capabilities` | Agents 子菜单 | `agents:view`（只读，不新增点） | 聚合 tool/mcp/skill/knowledge |
| Agent 观测 | `/agents/metrics` | Agents 子菜单 | `agents:view` | 图表参考 `Dashboard.vue`（vue-echarts 已装） |
| Run 详情增强 | 改 `views/Agents/AgentRunDetail.vue` | 不变 | 无新点 | **后端需补 usage/cost/agentVersion**，同步 `api/agents.ts` 类型 |
| 知识集合 | `/agents/knowledge` | Agents 子菜单 | `knowledge:view` / `knowledge:manage`（新增） | 新 `api/knowledge.ts` |
| 检索调试器 | `/agents/retrieval` | Agents 子菜单 | `agents:debug`（复用现有点，不新增） | 双栏形态参考 `AgentPlayground.vue` |
| 评测台 | `/agents/evals` | Agents 子菜单 | `agents:eval`（新增） | 查看随 `agents:view` |
| 发布门禁 | 挂 `AgentDefList.vue` 发布动作（现为 `a-popconfirm`） | 不变 | `agents:manage` | 发布现为行内 popconfirm，非弹窗 |
| 模型单价 | `/settings/models` | 系统设置下 | `agents:cost:view`（新增） | 注意 `/settings` 的 selectedKeys 顺序 |
| 平台总览扩展 | 改 `views/Dashboard.vue` | 不变 | `dashboard:view` | 复用现有 `.section-card` + `a-statistic` |

### 4. 新增一个页面必须同步改的文件（漏改即不同步/403）
1. `apps/admin/src/router/index.ts`：`/agents` 的 `children` 加路由 + `meta.permission`
2. `apps/admin/src/layouts/BasicLayout.vue`：**三处** —— 模板 `a-menu-item`（含 icon import）+ `watch(route.path)` 的 selectedKeys 分支 + `handleMenuClick` 的 `routes` 映射
3. `packages/types/src/index.ts`：`PermissionGroup` 增 `knowledge`；`PERMISSIONS` 加点；**`ROLE_PERMISSIONS` 必须补**（否则路由 403）
4. `apps/admin/src/views/Settings/RoleManagement.vue`：`GROUP_LABELS` 补 `knowledge`（顺带补缺失的 `database`）
5. 后端：新接口加 `@RequirePermission(...)`（user-service 无需改代码，启动自动 seed 权限点）

### 5. 已知坑（实现时规避）
- 路由守卫用常量而非后端权限 → 自定义角色即使 DB 授权也会被拦。
- 现有页面 `const canManage = userStore.hasPermission(...)` 是 setup 期一次性求值（非 computed）→ 新页面权限判断请用 computed 或 `v-has-perm`。
- `a-timeline` / `a-page-header` 在 Agents 页被使用但未见于 `plugins/antd.ts` 显式注册清单 → 实现前确认注册方式。
- 部署：新页面只改 admin 自身（shell 无需注册路由），但改完必须走微前端四步（构建→拷贝→版本表→验证 manifest）。

### 6. v1 / v2 / v3 三份原型的关系
| 稿 | 定位 |
|---|---|
| v1 `..._v1_观测与评测.html` | IA 总览（自造外壳，仅用于跨页流程走查） |
| **v3 `..._v3_整合Admin框架.html`** | **整合版：真实 admin 外壳 + 真实菜单/Token/路由落点，全部新页面可交互** |
| v2 `..._v2_<页面>.html` | 逐页高保真（实现编码依据，细节以 v2 为准） |

## 高保真拆分方案（开放决策 4 = 需要高保真拆分）

### 1. 与 v1 综合稿的关系
| 版本 | 形态 | 用途 | 是否实现依据 |
|---|---|---|---|
| v1 `agent-platform_原型_v1_观测与评测.html` | 9 页合一（侧边栏切换） | IA 总览、跨页流程走查 | 否（保留为索引） |
| **v2 系列**（逐页独立） | 每页一份 HTML | 逐页评审 + 编码依据 | **是** |

### 2. 文件清单与命名（目录 `docs/analysis/agent-platform/`，命名按 fe-developer §3）
| # | 文件名 | 对应规格书 | Phase | 保真重点 |
|---|---|---|---|---|
| 1 | `agent-platform_原型_v2_能力资产总览.html` | 10 号页 | P2 | 只读聚合、分区错误态、无权限 disabled+tooltip |
| 2 | `..._v2_观测台.html` | 1 号页 | P2 | KPI+趋势+下钻、列表四态 |
| 3 | `..._v2_Run详情.html` | 3 号页 | P2 | 轨迹时间线、成本/token 快照、坏例回收 |
| 4 | `..._v2_模型单价.html` | 4 号页 | P2 | 表单校验态、删除后果确认 |
| 5 | `..._v2_知识集合.html` | 5 号页 | P3 | 抽屉文档管理、上传 parsing→ready、授权 |
| 6 | `..._v2_检索调试器.html` | 6 号页 | P3 | 召回结果 score/来源、失败重试 |
| 7 | `..._v2_评测台.html` | 7 号页 | P4 | 跑批进度、报告 diff、用例编辑抽屉 |
| 8 | `..._v2_发布门禁.html` | 8 号页 | P4 | 拦截/无 smoke 两分支 |
| 9 | `..._v2_平台总览.html` | 2 号页 | P4 | KPI + 待处理跳转 |
| （可选）10 | `..._v2_微前端部署说明.html` | — | — | 仅当需演示发布/版本机制时 |

### 3. 高保真度标准（每页必须达标）
- 完整导航：侧边栏（当前项高亮）+ 面包屑/顶栏，视觉等同 admin 真实布局（1240×800 `.desktop`）
- 真实数据：≥6 行真实文案数据（agent 名/模型/工具名取自仓库实际值），禁 lorem
- 状态矩阵齐全：加载中（骨架屏）/ 空态（原因+出路）/ 失败可重试 / 破坏性二次确认 / 禁用 tooltip
- 分页与筛选：分页器静态呈现；筛选切换有真实响应（JS 过滤或 toast）
- 交互反馈：toast、弹层、抽屉、异步模拟（setTimeout）全部可点
- Token 一致：只引 `--ws-*`/本稿 `:root` 变量，主色 `#F97316`，图标 SVG 无 emoji，无 `!important`
- 每页底部注明"数据来源/聚合方式"，便于评审时核对后端契约

### 4. 评审与回填顺序
1. 先产第 1 页（能力资产总览）→ 用户校准保真度与粒度
2. 校准通过后按 Phase 顺序批量产出 2~9 页
3. 每页评审结论回填 `ui-prototypes.md` 对应规格书，再进 rd-execute 编码

### 全局待澄清（实现前逐项确认）
1. 路由接入点：以上 `/agents/*` 子路由是否并入 admin agents 路由子树（含菜单），待与 apps/admin 路由现状核对
2. 图表库沿用 admin 现有（不新引）；若现有无图表组件则补选型
3. 无单价记录的成本列按"不计 0 + 提示补配"实现（D3.3，不发明数值）
