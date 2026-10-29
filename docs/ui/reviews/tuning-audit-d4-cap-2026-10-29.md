# Design 评审报告 · D4 审计留存口径落地

> **本文档含 v2 口径修订**（2026-10-29 用户拍板）：条数口径「展示最近 50 条」→ 时间口径「保留近 7 天」。
> v1（50 条）已合并（PR #477 / `cf0551e1`）；**现行口径以「七、v2 口径修订」为准**，
> 一至六章保留作为 v1 的留档与「截断方向为什么取头部」的论证。

- 评审日期：2026-10-29
- 评审对象：`apps/admin/src/views/Agents/TuningAuditList.vue`
- 分支：`feat/agent-tuning-audit-d4-cap`（基线 `origin/master` `fe16b08a`）
- **形态判定：`Design: pass` —— 本次是【默认口径落地】，展示层裁剪，非形态改动**
  - 未改原型稿、未改 `admin-agents-hub.html`、未改父组件数据生产逻辑、未改类型定义、未动后端。

---

## 一、Why：D4 是「产品待拍板」项，本次落的是默认口径

出处：`docs/ui/prototypes/agent-def-tuning-质检记录.md:106`

| # | 项 | 性质 | 默认建议 |
|---|---|---|---|
| D4 | 审计留存条数 / 保留期未定义 | 产品待拍板 | 默认「展示最近 50 条，不做归档」 |

改前组件是纯展示组件，模板 `v-for="entry in entries"` **全量渲染**，无任何 slice / limit / 分页 /
裁剪 → D4 默认口径未落地。本次补的就是这条默认口径。

> 说明：D4 原始性质仍是「产品待拍板」。本次落地的是文档里给出的 **默认建议值 50**，
> 若产品后续拍板为其它数值，只需改 `AUDIT_VISIBLE_LIMIT` 一个常量，无需改结构。

---

## 二、改了什么（行号级，改动后文件 120 行）

单一文件 `apps/admin/src/views/Agents/TuningAuditList.vue`，+26 / −2。

| 行 | 改动 | 说明 |
|---|---|---|
| 6–11 | 新增文件头注释块 | 标注 D4 出处与「截断取头部、不删库」边界 |
| 19 | `v-for="entry in entries"` → `v-for="entry in visibleEntries"` | 模板改渲染截断后的数组 |
| 33–35 | 新增 `<div v-if="isTruncated" class="b3-audit-cap">` 提示行 | 仅在被截断时出现 |
| 42 | `import { computed } from 'vue'` | 新增 |
| 44–47 | 新增常量 `AUDIT_VISIBLE_LIMIT = 50` + 注释 | 注释引用 D4 出处与截断方向依据 |
| 49 | `defineProps` 改为 `const props = defineProps` | 供 computed 读取 |
| 54 | `visibleEntries = computed(() => props.entries.slice(0, AUDIT_VISIBLE_LIMIT))` | **核心截断** |
| 55 | `isTruncated = computed(() => props.entries.length > AUDIT_VISIBLE_LIMIT)` | 提示行开关 |
| 65–69 | 新增 `.b3-audit-cap` 样式 | 走 `--ws-*` 变量体系 |

未改动：`a-empty` 空态（第 18 行）、「仅超级管理员可见」`a-tag`、其余全部既有样式。

---

## 三、截断方向：靠读父组件证实，不是猜的（本次最关键的一步）

D4 只说「最近 50 条」，没说数组哪头是「最近」。写反了就会把**最老的 50 条**留下，
且因为列表本来就有 50 条、长度看起来正常，**不会报错、不会空态，是静默错误**。因此先查证再动手。

### 证据链

1. `AgentDefDetail.vue:157` —— 本组件的唯一调用点，传入 `auditEntries`：
   ```vue
   <TuningAuditList :visible="true" :entries="auditEntries" />
   ```
2. `AgentDefDetail.vue:213` —— 数据源声明：
   ```ts
   const auditEntries = ref<TuningAuditEntry[]>([]);
   ```
3. **`AgentDefDetail.vue:417` —— 决定顺序的那一行（前置插入）**：
   ```ts
   auditEntries.value = [entry, ...auditEntries.value];
   ```
   新条目 `entry` 落在**数组头部**，旧条目整体右移 → **最新在前（newest first）**。

### 结论与实现

最新在**头部** → 必须保留头部，取 `slice(0, 50)`，**不能**写 `slice(-50)`。

逐字实证（node 复刻 417 行的前置插入语义，写入 120 条）：

| 断言 | 结果 |
|---|---|
| 数组头部 `entries[0]` | `120`（最新） |
| 数组尾部 `entries[119]` | `1`（最老） |
| `slice(0, 50)` 后 `visible[0]` | `120` ✅ 保留的是最新 |
| `slice(0, 50)` 保留区间 | `120 … 71`（最近 50 条）✅ |
| 反例 `slice(-50)` 的 `wrong[0]` | `50` ❌ 会留下**最老**的 50 条 → 即被规避的静默 bug |

### 验证门不是空转（mutant 测试）

为确认「typecheck 通过」是真证据而非空跑，对改动文件注入缺陷回读：

| 注入 | 结果 |
|---|---|
| `props.entries.length` → `props.entries.lengthTYPO` | exit **2**，`TuningAuditList.vue(55,50): error TS2339` ✅ 能捕获 |
| 模板 `{{ AUDIT_VISIBLE_LIMIT }}` → `{{ UNDEFINED_VAR_XYZ }}` | exit **2**，第 34 行 TS2339 ✅ 模板标识符确实受检 |
| 还原后 | exit **0**，零错误 ✅ |

（`vue-tsc --listFiles` 确认本文件在编译程序内；模板报错信息中可见实例已暴露
`visibleEntries` / `isTruncated`，证明二者绑定正确。）

---

## 四、被截断提示：文案与样式依据

**文案**：「仅展示最近 {{ AUDIT_VISIBLE_LIMIT }} 条调参记录（共 {{ entries.length }} 条）」
→ 渲染为例如「仅展示最近 50 条调参记录（共 120 条）」。

| 决策 | 依据 |
|---|---|
| 位置：列表末尾 | 顺用户阅读动线；读到列表底才知道「还有更老的没显示」，放标题旁会在未滚动时抢注意力 |
| 数字用常量插值而非硬编码 50 | 常量一改，提示文案自动跟随，不会与截断逻辑脱节 |
| 仅在 `entries.length > 50` 时出现 | 未截断时不产生噪声；≤50 条时视觉与改前完全一致 |
| 样式 `.b3-audit-cap`（65–69 行） | `font-size: 12px` + `color: var(--ws-text-secondary, #525252)`，与既有 `.b3-audit-time` / `.b3-audit-op` / `.b3-runtime` 同一档次要文字；**未引入任何新颜色字面量**，沿用组件已有 `--ws-*` 变量与 `b3-audit-*` 命名 |
| `padding-top: 10px` | 与上方条目留分隔间距 |

> 副作用（可接受，无需额外处理）：原 `.b3-audit-item:last-child { border-bottom: none }`
> 在出现提示行时不再命中最后一条审计条目，最后一条会保留一条分隔线，视觉上恰好充当提示行的分隔。

---

## 五、「不做归档」的边界说明

D4 原文是「展示最近 50 条，**不做归档**」。本改动严格只落在展示层：

| 边界 | 本改动的行为 |
|---|---|
| 数据 | **不删除、不裁剪** `entries` 数组本体；`slice()` 返回新数组，不改动 `props.entries` |
| 存储 | **不写库、不加任何后端归档/清理逻辑、不加定时清理** |
| 父组件 | **未改** `AgentDefDetail.vue` 第 417 行的数据生产逻辑，超管仍累积全量 `auditEntries` |
| 类型 | **未改** `TuningAuditEntry`（`apps/admin/src/utils/tuning-params.ts:347`） |
| 被截掉的旧条目 | 仅**不在本面板渲染**，数据仍在内存中；本次会话内刷新/重新挂载后依旧是全量 |

由此带来的**已知缺口**（照实列出，非阻塞）：
内存中 `auditEntries` 仍无限增长，长时间单次会话下内存会随保存次数线性上升。
本次按 D4「不做归档」执行，不引入清理；若后续要治理，属**独立议题**（需产品拍板保留期 + 后端落库），不在本补丁范围。

---

## 六、验证记录

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `apps/admin` 下 `vue-tsc --noEmit` | **exit 0**，零错误 |
| 编译程序覆盖 | `vue-tsc --noEmit --listFiles \| grep TuningAuditList` | 命中本文件（41 个 .vue 在内） |
| 反向验证 | 注入 TYPO / 未定义模板变量 | 均 exit 2 报错，还原后 exit 0 |
| Lint | `eslint apps/admin/src/views/Agents/TuningAuditList.vue` | **exit 0**，零告警 |
| 截断语义 | node 复刻前置插入 + slice 断言 | `slice(0,50)` 保留最新 50 条 ✅ |
| 改动面 | `git diff --stat` | 1 file changed, 26 insertions(+), 2 deletions(-) |

未跑浏览器视觉校验（本改动为收尾补丁、范围限定，且提示行为由 `v-if` 条件与既有样式体系保证）。

---

# 七、v2 口径修订：条数（50 条）→ 时间（近 7 天）

- 修订日期：2026-10-29
- 触发：**用户拍板「保留近 7 天就好」**
- 分支：`feat/agent-tuning-audit-d4-retention-7d`（基线 `origin/master` `cf0551e1`，即 v1 合并后 tip）
- **形态判定：`Design: pass` —— 仍是【默认口径落地】；本次因口径性质变化，范围扩到类型定义与父组件**

## 7.1 为什么改成时间口径

v1 落的是文档默认建议值「最近 50 条」。用户拍板给的是**留存期**，两者性质不同：

| | v1 条数口径 | v2 时间口径 |
|---|---|---|
| 判据 | `entries.length > 50` | `now - ts < 7d` |
| 语义 | 保留最近 N **次**调参 | 保留近 N **天** |
| 低频使用时的表现 | 半年前的 50 条仍霸屏 | 超 7 天自动淡出 ✅ 符合「留存期」直觉 |
| 高频使用时的表现 | 7 天内第 51 条被砍 | 7 天内 200 条也全留 |

用户要的是「旧的自己会消失」，条数口径做不到这一点，故替换。

## 7.2 为什么必须新增 `ts` 字段（不能直接解析 `time`）

`TuningAuditEntry.time` 是 `new Date().toLocaleString('zh-CN', { hour12: false })`，
形如 `2026/10/29 14:42:40` —— **本地化展示串**。

拿它做时间过滤要先反解析，风险是静默失效：locale 一变（zh-CN → en-US）、
或 Node/浏览器 ICU 版本差异导致格式变成 `10/29/2026, 14:42:40`，解析结果就偏了，
**不报错、只是过滤错**，是最难发现的那类缺陷。

因此：
- 新增 `ts: number`（epoch 毫秒），**留存判定只认 `ts`**
- **保留** `time: string` 继续供模板渲染（未删，避免动展示层）
- 两者同源：`buildTuningAuditEntry` 里 `time` 由 `ts` 派生（`new Date(ts).toLocaleString(...)`），
  不会互相打架
- 另加可选 `ts?: number` 入参供单测注入固定时间戳（与既有 `time?: string` 对称）

## 7.3 边界判据（已写入代码注释）

```ts
export const TUNING_AUDIT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function isWithinTuningAuditRetention(ts: number, now = Date.now()): boolean {
  return now - ts < TUNING_AUDIT_RETENTION_MS;   // 左闭右开
}
```

| 情形 | 判定 | 理由 |
|---|---|---|
| 刚发生（`now - ts === 0`） | 保留 | — |
| 差 1ms 满 7 天 | 保留 | 边界内侧 |
| **刚好 7 天**（`=== RETENTION_MS`） | **不保留** | 边界取**开**；「近 7 天内」不含第 7 天整点这一刻 |
| 7 天 + 1ms | 不保留 | — |
| 8 天前 | 不保留 | — |
| **未来时间**（`ts > now`） | **保留** | `now - ts` 为负 → 落在区间内。时钟回拨 / 跨设备数据不该被「清更老的」逻辑误藏 |

## 7.4 为什么是「替换」不是「叠加」

用户原话「保留近 7 天**就好**」→ 7 天内即使超过 50 条也照常展示。
若再叠加 50 条上限，7 天内第 51 条会被砍，与「就好」矛盾。
故 **删除** `AUDIT_VISIBLE_LIMIT = 50` 与 `slice(0, 50)`，只留时间过滤。
单测已钉住这条：「7 天内即使超过 50 条也照常展示（120 条全留）」。

## 7.5 落点：写入时 prune，而不只是展示层过滤

只在组件里过滤的话，超期条目只是不渲染、仍堆在 `auditEntries` 里随保存线性增长
（v1 遗留项）。既然用户给的是**留存期**，正确落点是写入即 prune：

```ts
// AgentDefDetail.vue:419（原 :417）
auditEntries.value = pruneTuningAuditEntries([entry, ...auditEntries.value]);
```

（指令原文是 `.filter(e => isWithinTuningAuditRetention(e.ts))`；此处用同语义的
`pruneTuningAuditEntries` 包装，便于父组件与组件共用同一口径、且可单测。行为完全一致。）

`:213` 声明与 `:157` 调用点未动。

## 7.6 响应式 tick 为什么必须加

`computed` 里直接调 `Date.now()` **不会**随时间自动重算 —— `Date.now()` 不是响应式依赖。
页面长时间开着且用户不保存时，屏幕上会一直留着已超期的条目（只有下次保存触发重算才消失）。

处理：`nowTick` ref + `setInterval` 60s 推一次，把「时间流逝」变成 computed 的依赖；
`onBeforeUnmount` 里 `clearInterval`（**已加，不留泄漏**）。
60s 是精度与开销的折中：留存期是 7 天量级，条目最多晚一分钟消失，无感。

## 7.7 改动清单（行号级）

| 文件 | 改动 |
|---|---|
| `apps/admin/src/utils/tuning-params.ts` | `TuningAuditEntry` 加 `ts: number`；导出 `TUNING_AUDIT_RETENTION_MS`、`isWithinTuningAuditRetention`、`pruneTuningAuditEntries`；`buildTuningAuditEntry` 填 `ts`（并支持注入） |
| `apps/admin/src/views/Agents/AgentDefDetail.vue` | import 加 `pruneTuningAuditEntries`；`:419` 写入时 prune |
| `apps/admin/src/views/Agents/TuningAuditList.vue` | 删 `AUDIT_VISIBLE_LIMIT`/`slice`；改时间过滤 + `nowTick`；提示行文案改「仅展示近 7 天内的调参记录，已隐藏 M 条更早记录」；`v-if` 条件改 `hiddenCount > 0`；注释同步（原「截断取头部」注释已改，避免误导） |
| `apps/admin/src/utils/tuning-params.spec.ts` | 新增 14 条 D4 留存期用例 |

提示行样式沿用 v1 的 `.b3-audit-cap`（`--ws-text-secondary` + 12px），**未引入新颜色字面量**。
数字 7 由 `TUNING_AUDIT_RETENTION_MS` 反算，改常量文案自动跟随，不会脱节。

## 7.8 验证记录（v2）

| 项 | 结果 |
|---|---|
| `vue-tsc --noEmit` | **exit 0**，零错误 |
| typecheck 变异验证（4 例） | 3 个改动文件注入 typo → **全部 exit 2 报错**，定位到具体行列，还原后 exit 0 |
| 单测 | **59 passed**（基线 45 + 新增 14） |
| 单测变异验证（6 例） | **6/6 被抓到**（见下） |
| 10 条实证 | 3 条 8 天前 → 剩 7 条、hidden=3，提示行渲染「已隐藏 3 条更早记录」 ✅ |
| eslint（4 个文件） | **exit 0**，零告警 |

### 单测变异验证：证明断言真能 FAIL（不是摆设）

| 变异 | 期望被哪条断言抓住 | 结果 |
|---|---|---|
| M1 `<` → `<=`（边界取闭） | 「刚好 7 天 → 不保留」 | **被抓到**：Expected false / Received true ✅ |
| M2 `<` → `>`（方向反） | 多条基础用例 | 被抓到 ✅ |
| M3 加 `&& ts <= now`（未来时间误判） | 「未来时间 → 保留」 | 被抓到 ✅ |
| M4 留存期改成 30 天 | 「8 天前 → 不保留」 | 被抓到 ✅ |
| M5 prune 退化成不过滤 | 「10 条剩 7 条」/「内存收敛」 | 被抓到 ✅ |
| M6 prune 漏掉首条 | 「写入时 prune」 | 被抓到 ✅ |

变异后均还原，`git diff` 复查无残留。
