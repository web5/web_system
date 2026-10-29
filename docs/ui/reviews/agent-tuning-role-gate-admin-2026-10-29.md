# Design 评审报告 · B3 调参区角色门禁放开 admin（super_admin + admin）

- 评审日期：2026-10-29
- 触发：用户拍板「帮我把 admin 也改成支持 agents 参数调试的权限吧」
- 分支：`feat/agent-tuning-gate-admin`（基线 `origin/master` `b461fc7f`）
- 评审对象：原型 `admin-agent-def-detail.html` + hub 重建 + 机检 + page-spec + 前端门禁
- **形态判定：`Design: pass` —— 门禁口径修订（角色可见性），非布局/交互形态改动**

---

## 一、为什么只改前端（后端本就允许 admin，贴行号）

### 后端：零端点有 super_admin 专属守卫

`servers/ai-service/src/agent-def/agent-def.controller.ts`（`@Controller('admin/agent-defs')`，:21）
全部 10 个端点只挂两类权限装饰器，**没有任何 super_admin 专属判断**：

| 行 | 端点权限 |
|---|---|
| :28 / :39 / :46 / :81 | `@RequirePermission('agents:view')` |
| :53 / :60 / :67 / :74 / :88 / :95 | `@RequirePermission('agents:manage')` |

`packages/types/src/index.ts:208-228` `ROLE_PERMISSIONS`：`admin` 持有除
`database:query` / `storage:browse` 外的全部权限（`:212-215` 的 filter 只排除这两项），
**天然含 `agents:manage`**。

→ 后端现状即目标态，一行不用动。此前「仅 super_admin」只是**前端 UI 层自行收紧**。

### ⚠️ 顺带发现的一处事实（如实记录，不在本次处理）

`ROLE_PERMISSIONS.editor`（`:216-222`）**也持有 `agents:manage`**。即：

- 本次前端门禁（放 admin、仍藏 editor）**比后端更严**——editor 走 API 仍能调通 manage 端点
- 这不构成放权（前端只影响 UI 可见性），也不是本次引入的（后端权限矩阵早已如此）
- 若产品后续想让 editor 也见调参区，有据可依（后端已放）；若想真正收紧 editor，
  那是**后端权限矩阵议题**，超出「放开 admin」的本意，不夹带

## 二、判据公式（唯一真源）

```ts
// apps/admin/src/utils/tuning-params.ts
export function canAccessTuning(roles: string[] | undefined | null): boolean {
  return Array.isArray(roles) && (roles.includes('super_admin') || roles.includes('admin'));
}
```

| roles | 判定 | 口径 |
|---|---|---|
| `['super_admin']` | ✅ | 原有 |
| `['admin']` | ✅ | **本次放开** |
| `['super_admin','admin']` | ✅ | 任一命中即可 |
| `['editor']` / `['viewer']` | ❌ | 不在放开范围 |
| `[]` / `undefined` / `null` | ❌ | 空角色不可见（保持） |

函数名 `canAccessTuning` 保留（两处调用点沿用，不做无谓改名扩散）。

## 三、S5 场景语义翻转（原型）

| | 旧口径 | 新口径 |
|---|---|---|
| 门禁属性 | `data-need-role="superadmin"` | `data-need-role="admin"`（语义：admin 及以上） |
| CSS 隐藏规则 | `html[data-demo-role="admin"] …`（hide admin） | `editor` + `viewer` 两条（hide 低权角色） |
| S5 | 普通管理员 · 调参不可见 | **编辑者 · 调参不可见**（`role=editor + state=forbidden`） |
| S5b（新增） | — | **普通管理员 · 调参可见**（`role=admin + state=normal`），钉住本次拍板 |
| 演示角色 | 超管 / 普通管理员（2 个） | + 编辑者 / 查看者（4 个），S5 才有得演 |
| 文案 | 「仅超级管理员可见/可编辑」 | 「仅管理员及以上可见/可编辑」 |

场景标签按钮同步：S5 改名，新增 S5b 按钮（`data-dc-preset="p5b"`，`applyPreset` 无该键时跳过，机制本就支持可选）。

## 四、机检（E）

**先纠正一个前提**：`scripts/verify-agent-def-detail.mjs`（136 条断言）经 grep 全文
（`role|superadmin|super_admin|preset|dc-`）**原本没有任何角色可见性断言**——
「仅 super_admin 可见」从未被机检锁过，这次是**新增**而非改写。
原有一条相关断言在 `verify-agents-hub.mjs:655`：仅断言 CSS 规则字符串存在（结构级）。

新增/调整：

| 位置 | 内容 |
|---|---|
| `verify-agent-def-detail.mjs` 24a–24e（新增 5 条，136→141） | 真点角色按钮后按 computed display 判定 `#card-adv` / `#card-audit` 真实可见性：超管可见 / **admin 可见** / editor 不可见 / viewer 不可见 / editor 下 `role-fallback` 兜底可见 |
| `verify-agents-hub.mjs:655` | 原 1 条 CSS needle → 2 条（editor / viewer 各一） |
| `verify-agents-hub.mjs` 11a-2（新增） | 断言 hub **不再含** `data-need-role="superadmin"`（防旧口径回潮） |

跑绿：`verify-agent-def-detail.mjs` **141 项全过**；`verify-agents-hub.mjs` **exit 0**。

### 变异证据（证明机检真能红，不是摆设）

| 变异 | 手法 | 结果 |
|---|---|---|
| 实现「把 admin 分支删掉」（回退旧口径） | CSS 隐藏规则加回 `admin` | **24b FAIL**：普通管理员应可见却不可见 → `❌ 失败 1 项` ✅ |
| 实现「把 editor 分支误加进去」 | CSS 删掉 editor 隐藏规则 | **24c FAIL**：编辑者应不可见却可见 → `❌ 失败 1 项` ✅ |

变异后均还原，`diff` 确认与备份一致。

## 五、hub 单源纪律（D）

只改源稿 `admin-agent-def-detail.html`，hub 由 `node scripts/build-agents-hub.mjs` 重新生成
（**未手改**）。复现性验证：连续两次 build，`diff` 为 0。
hub 内容核验：`data-need-role="admin"` 18 处命中、`data-need-role="superadmin"` **0** 处。

## 六、page-spec 补缺口（F）

`docs/ui/page-specs/agent-def-detail-v2.md` **原本完全没记载调参区门禁**（grep
`仅超|super_admin|S5|data-need-role` 均 0 命中）——不是「改表述」而是**补缺口**。
新增 §5.1「角色门禁（S5）」：四角色判定表、判据唯一真源指向 `canAccessTuning`、
S5/S5b 演示口径、机检索引。

`B3-原型说明.md` 在仓库外（`~/AiWorkspace/30-任务产物/2026-10-26-AI-Agent能力实施/`），
同步改口径一行并注明拍板日期（不进本仓库 commit）。

## 七、验证记录

| 项 | 结果 |
|---|---|
| 机检 verify-agent-def-detail（含新 24a–24e） | **141 项全过** |
| 机检 verify-agents-hub（含新 11a-2） | **exit 0** |
| 机检变异 ×2 | 24b / 24c 分别 FAIL ✅ |
| hub 重建复现 | 两次 build diff = 0 |
| hub 旧属性残留 | `data-need-role="superadmin"` 计数 **0** |
| typecheck / eslint / 单测 | 见实现 commit（②）验证记录 |
