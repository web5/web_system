## 页面规格书 · admin 每日美句只读查看页

> Spec: pass
> 关联方案: `docs/development/reports/2026-11-25-admin-daily-quotes-ui-方案.md`（s28 基线）+ `docs/development/reports/2026-11-25-admin-source-filter-方案.md`（s36 增量）
> 原型继承: `Proto: ee0c6bc5d6ce8405` / `Design: pass`（156 原型，s28 基线）；s36 增量原型 `Proto: 3ac228a0a62df6c8` / `Design: pass`（167 附件，新算 sha 未复用旧值）
> 需求真源: 157 稿 §四 / §六矩阵（基线）；167 稿 §一/§四/§七（来源筛选增量，本文件为实施阶段独立交互清单）

- 页面类型：列表页（只读） + 详情抽屉
- 参照页：`apps/admin/src/views/Content/NceLessons.vue`（主参照，同一 content 功能组）
- 需求一句话：把服务端已冻结的 136 条每日美句暴露给持 `content:view` 的运营核对，零写入口。

### 页头
- 标题：每日美句（h2 20px `#1A1A1F`）
- 副标题：`服务端冻结池 · {count} 条 · version {version}` + 「只读」徽标
- 主操作：**无**（唯一交互按钮为搜索、刷新、预览、关闭；空态/错误态的恢复按钮）

### 模块清单（自上而下）
| 序 | 模块 | 数据来源/API | 承载组件 | 空态策略 | 备注 |
|---|---|---|---|---|---|
| 1 | 工具条 | — | **来源筛选表单**：册别 `a-select`（全部/NCE2/NCE3/NCE4）+ 课号 `a-input` + 清空 + 分隔线；再接 `a-input-search` 280px + 刷新 `a-button` + 只读 hint | — | 筛选/搜索控件均为**查询控件**（绑定筛选 ref，非写控件）；三者 AND；变化重置第 1 页；hint 声明不生成/不编辑/不删除 |
| 2 | 数据表格 | `getDailyQuotes()` 整池（客户端过滤/切片，册别∧课号∧keyword） | `a-table` middle，5 列，`rowKey=(book,lessonId,lineIndex)` | `a-empty`「没有匹配的美句」+「清空筛选与搜索」 | 20 条/页客户端分页；册别经工具条下拉筛选（非表头 tab）；接口无筛选参数 |
| 3 | 详情抽屉 | 当前行对象（无二次请求） | `a-drawer` width 900 + `moduleOverlayContainer` | 草稿空态「未取到美句数据」 | cn/en + 4 个 source 字段全名 + 版权注记；仅「关闭」 |
| 4 | 错误态 | 请求失败标志 | `a-spin` 内错误块 +「重试」 | — | 不显示伪数据 |

### 表格列清单
| 列 | 来源字段 | 展示规则 | 操作 |
|---|---|---|---|
| # | `source.lessonId` | `L{n}` tabular-nums | — |
| 英文 / English | `en` | Georgia / `#1A1A1F` / ellipsis | — |
| 中文 / Chinese | `cn` | 系统字体 / `#6B7280` / ellipsis | — |
| 来源 / Source | `source.book/lessonId/title/lineIndex` | 三行摘要：`NCE2 · L{n}` / title / `source.lineIndex = {n}` | — |
| 操作 | — | link 按钮 | 「预览」→ 抽屉 |

### 交互清单（每条操作一行）
| 操作 | 触发 | 反馈（成功/失败） | 是否破坏性→确认文案 | 完成后动作 |
|---|---|---|---|---|
| 册别筛选 | 下拉选 NCE2/NCE3/NCE4/全部 | 客户端 `source.book === 选中`（ALL 不过滤），计数 136/80/65/281，回第 1 页 | 否 | 列表重渲；与课号/keyword 为 AND |
| 课号筛选 | 输入课号串（可选） | 客户端 `String(lessonId).includes(trim)`，不做区间，回第 1 页 | 否 | 列表重渲；输入 `3` 命中 L3/L31 等 |
| 搜索 | 输入 / 回车 | 客户端过滤 cn/en/source.title/String(lessonId)，与册别/课号 AND，回到第 1 页 | 否 | 列表重渲；叠加无命中给「清空筛选与搜索」 |
| 清空 / 清空筛选与搜索 | 工具条按钮 / 空态按钮 | 册别回 ALL、课号/keyword 清空、回第 1 页 | 否 | 恢复 281 条（不触发任何写接口） |
| 刷新 | 工具条按钮 | 重新 GET 整池，成功覆盖数据；失败进错误态 | 否 | 页码复位 |
| 翻页 / 改每页 | 分页条 | `slice` 本地切片；不改接口 URL | 否 | 表格重渲 |
| 预览 | 行内 link | 抽屉打开，展示当前行 cn/en + 四 source 字段 + 注记 | 否 | 关闭按钮退出 |
| 重试 | 错误态按钮 | 重新加载 | 否 | 成功→数据态；失败→留错误态 |
| 关闭 | 抽屉按钮 / 遮罩 / ESC | 抽屉关闭 | 否 | 无写操作 |

### 状态覆盖自查
- [x] 加载中：`a-spin`（骨架态）
- [x] 空态：`a-empty` + 唯一出路口「清空搜索」
- [x] 失败可重试：错误块 + 唯一出路口「重试」
- [x] 无权限：路由 meta `content:view` → `/403`；侧栏 content 子菜单整组不可见
- [x] 破坏性二次确认：不适用（无破坏性操作）
- [x] 禁用 tooltip：不适用
- [x] 保存中防重复提交：不适用（无写操作）
- [x] 无弹窗套弹窗：抽屉是唯一浮层

### 原型继承（分支清单以原型 7 个场景包为单一来源）
| 原型场景 | 路由 | 权限码 | 数据态 | 期望结果 | 规格落点 |
|---|---|---|---|---|---|
| S1 主路径 | `/content/daily-quotes` | `content:view` | normal | 列表 + total 136 + 只读徽标 | 模块 1/2 |
| S2 点预览 · 来源 | 同上 | `content:view` | normal + 抽屉 | 四 source 字段全名 + cn/en + 注记，仅关闭 | 模块 3 |
| S3 骨架时序 | 同上 | `content:view` | loading | `a-spin` 遮罩，无伪数据 | 模块 4 |
| S4 搜索无命中 | 同上 | `content:view` | empty | 空态 + 清空搜索 | 模块 2 |
| S5 失败重试 | 同上 | `content:view` | error | 错误块 + 重试 | 模块 4 |
| S6 无权限 | 直达路由 | 无 `content:view` | forbidden | `/403`，菜单无入口 | 状态自查 |
| S7 一致性参照 | `/content/nce-lessons` | `content:view` | normal | 仅参照，不在改动范围 | 页头/表格/抽屉 token 对照 |

> 演示控件（`data-demo-*`、场景包、标注层）**不进实现**。

### 视觉 Token（不出现裸 hex 于交互清单之外的说明）
- 背景 `#FFFFFF`；正文 `#1A1A1F`；次级 `#6B7280`；品牌交互 `#F97316`（仅边框/徽标底）；品牌文本 `#EA580C`（白底 4.9:1 过 AA）；青色强调 `#0EA5A4`（序号）。
- 与 `NceLessons.vue` 同款白底浅色体系；无深色卡面、无 emoji 图标。

### 风险/待澄清
- 本轮只出代码与 PR，不出码不发布；目标环境须先具备 daily-quotes 接口 + seed 数据，否则页面走错误态（符合设计）。
- 无新增权限常量；`content:view` 已存在，pre-flight 确认目标环境仍在即可。

### 增量 · 来源筛选表单（s36 / 167 稿）

- 需求一句话：v2 池 281 条横跨三册，工具条加「册别下拉 + 可选课号 + 清空」按来源收窄查看范围；**查询控件，非写入口**。
- 状态数据：`bookFilter: 'ALL'|'NCE2'|'NCE3'|'NCE4'`（默认 ALL）+ `lessonFilter: ''`（默认空）；筛选态只在前端 ref，接口整池一次返回无参数。
- 组合逻辑：`filtered = 册别 ∧ 课号(includes) ∧ keyword`，任一条件变化 → `page=1`；叠加无命中 → `a-empty` + 唯一恢复入口「清空筛选与搜索」。
- 只读边界（167 §1.6）：册别 `a-select`、课号/搜索 `a-input`、清空按钮均为**查询控件**，语义放行；表格单元格内编辑控件、写语义按钮（新增/编辑/删除/保存/提交/生成/批量）零容忍。
- 视觉：沿用现页浅色白底 token；`#F97316` 仅交互色、文本强调 `#EA580C` 过 AA；工具条 flex-wrap 窄屏换行，新增 1px 分隔线区分来源筛选与搜索。
- 验证：见 `docs/development/reports/测试用例-admin来源筛选表单.md`（V1–V13 + 三组真实文件变异红绿）。
