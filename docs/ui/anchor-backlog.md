# 存量锚点回填清单（anchor-backlog.md）

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 设计：`specs/design-reviewer/design.md` §3.7.1（存量过渡）｜判据：`docs/ui/design-system.md` §3.2 A1–A4
> 批次顺序已拍板（Q4，2026-09-22）：**admin 主流程 → portal 主流程 → 小程序主包 → 分包低频**
> 单批次节奏已拍板（Q5）：**批次内先 `warn` 观察一轮，再升 `strict`**

## 1. 回填什么（不是"给所有元素打标"）

- 只给**关键结构元素**打 `data-dr="<key>"`（A2）：页头、主操作、筛选区、列表容器、状态区、主表单、主导航。**不逐元素打**。
- 原型侧与实现侧**同名同语义**（A3）；改名/删除须同步两侧并在评审报告登记。
- **未回填 ≠ 已漂移**：原型侧无 `data-dr` 时扫描器输出 `SKIP`，CI 不判违规（A4）。
- 匹配口径：**按 key 全局匹配，不按文件映射**——避免维护"原型文件 ↔ 页面文件"映射表（维护成本高于收益，且易腐）。

## 2. 存量现状（2026-09-22 实测 `git ls-files`）

| 批次 | 范围 | 界面文件数 | 状态 |
|---|---|---|---|
| **B1a** | `apps/deploy-console`（admin 系主流程） | 38 `.vue` | 待开始 |
| **B1b** | `apps/admin` | 26 `.vue` | 待开始 |
| **B2** | `apps/portal` | 35 `.vue` | 待开始 |
| **B3** | `apps/kedou-ai-minigram/pages`（小程序主包） | 8 `.wxml` | 待开始 |
| **B4** | `apps/kedou-ai-minigram/package*`（分包）+ `packages/ui` | 20 `.wxml` + 2 `.vue` | 待开始 |
| — | `apps/mcp-admin` | 0 `.vue` | 无文件，跳过 |

合计 **129** 个界面文件。B1a 与 B1b 可并行推进（同属 admin 系一个观察轮）。

## 3. 推进方式（`DESIGN_ANCHOR_MODE` 四档）

```bash
# ① 回填前（默认）：全部跳过，存量 PR 零摩擦
DESIGN_ANCHOR_MODE=off    bash scripts/redline/scan-rules.sh diff origin/master...HEAD

# ② 批次内观察一轮：全部 warn（不阻断）
DESIGN_ANCHOR_MODE=warn   bash scripts/redline/scan-rules.sh diff origin/master...HEAD

# ③ 该批升 strict（按 app 白名单，其余仍 warn）—— Q5 的落地形态
DESIGN_ANCHOR_MODE=scoped DESIGN_ANCHOR_SCOPE=deploy-console \
  bash scripts/redline/scan-rules.sh diff origin/master...HEAD

# ④ 全量回填完成：全局 strict
DESIGN_ANCHOR_MODE=strict bash scripts/redline/scan-rules.sh diff origin/master...HEAD
```

单批自检（不进 CI，随时可跑）：

```bash
python3 scripts/redline/scan-design-drift.py anchors HEAD      # 锚点集合比对
python3 scripts/redline/scan-design-drift.py lint <file...>    # 可机检视觉条目（G1/E3/X4/X5/F1）
```

## 4. 每批的完成定义（DoD）

- [ ] 该批关键结构元素**两侧**锚点已打且同名
- [ ] `scan-design-drift.py anchors HEAD` 对该 app 输出 `INFO`（集合一致），而非 `SKIP` / `MISSING`
- [ ] `warn` 观察一轮无异常（无误报、无噪音）
- [ ] 该批 app 名写入 `DESIGN_ANCHOR_SCOPE`（CI 侧对该批 error，其余仍 warn）
- [ ] 本表「状态」与日期已更新

## 5. 逐文件清单不在此硬编码

上百行路径会腐化（文件增删即失效）。需要时按批次命令生成：

```bash
git ls-files 'apps/deploy-console' | grep -E '\.vue$'
git ls-files 'apps/kedou-ai-minigram/pages' | grep -E '\.wxml$'
```

## 6. 关联

- 判据条目：`docs/ui/design-system.md` §3.2 A1–A4
- 评审关口：D3 实现一致性（`design-reviewer` SKILL.md）
- 上线值守：R11=error 首周专人值守（Q6，用户已安排）
