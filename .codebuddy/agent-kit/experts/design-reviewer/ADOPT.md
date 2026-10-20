# ADOPT.md · 如何把 design-reviewer 接进你的项目

> 本专家**自带判据**（`references/design-system.md`，76 条编号判据）。
> 你可以全盘接受、部分替换、或完全自建 —— 三种档位见 §2。
> 这是 `experts/` 层独有的文件：`skills/` 只有方法，专家还要告诉你怎么落地。

---

## §0 一句话

一个**独立的第三方设计评审角色**：不出稿、不改代码、不替你拍板，只产出「带判据编号 + 反例 + 严重级」的评审报告。

---

## §1 接入前检查

| # | 你的项目需要具备 | 没有怎么办 |
|---|---|---|
| 1 | 有可评审的**设计产物**（原型 HTML / 页面规格 / 实现代码 + 截图） | 先用 `ux-prototype-designer` 出稿，再评审 |
| 2 | 有**出稿方**（谁生产设计产物） | 专家的定位是评审，不是出稿；没出稿方则评审无对象 |
| 3 | 能接受「评审结论分三态：通过 / 有条件通过 / 阻塞」 | 若只想听好话，这个专家不适合 |

---

## §2 判据替换指南（三档）

### 档 A · 全盘接受（最快，推荐先这么跑）

直接用自带的 76 条。**约 70% 条目跨项目通用**，可立即生效：

| 组 | 条目 | 是否可直接用 |
|---|---|---|
| 设计原则 | P1–P6 | ✅ 通用 |
| 层级 / 密度 | E1–E13 | ✅ 通用（引用 token 名需映射，见下） |
| 间距对齐 | F1–F6 | ✅ 通用 |
| 色彩语义 | G1–G12 | ⚠️ G1/G4/G5 引用了 `--ws-*` / `--brand*` 具体前缀 |
| 交互模式 | M1–M6 | ✅ 通用 |
| 锚点约定 | A1–A4 | ✅ 通用（`data-dr` 是纯约定，与框架无关） |
| 状态矩阵 | S1–S9 | ✅ 通用 |
| 文案语气 | H1–H6 | ✅ 通用 |
| **端差异** | **I1–I5** | ❌ **项目专属，必须替换**（web_system 是「admin 系 + 品牌端」二分） |
| 反模式 | X1–X9 | ✅ 通用 |

**token 名映射**：判据里写的是 `--ws-*`（admin 系）与 `--brand*`（品牌端）。你的项目若用别的命名（如 `--app-*`），在 `design-system.local.md` 里做一次映射声明即可，不必改判据原文。

> 除 token 名外，判据还引用数值源文件、参照页、落盘目录等**文件级外部物**——即使走档 A，也建议花 2 分钟过一遍 §2.5 映射表（尤其参照页，不指定则密度类判定只能降级为建议）。

### 档 B · 部分替换（推荐长期形态）

建 **`references/design-system.local.md`** 覆盖需要改的部分，例如：

```markdown
# 本项目的判据覆盖（design-system.local.md）

## 覆盖条目
- [I1] 本端主色取 `--app-brand-500`；文本/选中态用 `--app-brand-700`（过 AA）
- [I2] 页面底 `--app-bg-page`，容器 `--app-bg-surface`
- [I4] 单位用 px，字阶见 `src/tokens/font.ts`

## 不采用的条目
- [I3] 本端无「admin 系 vs 品牌端」二分，此条不适用
- [E13] 控件高度阶梯本端未建立，暂不判（待 token 层补齐后启用）
```

> ★ **同步机制对 `*.local.md` 永不覆盖**（`scripts/sync-to-target.sh` 保护清单），所以你的覆盖不会被上游更新冲掉。

### 档 C · 完全自建

删掉自带判据，只保留**评审协议**（`SKILL.md` 的独立性机制 + 报告格式 + 严重级），判据换成你自己的。

> ⚠️ **水位提示**：档 C 下专家只剩「评审的组织方式」，判据质量取决于你自己建的库。这正是方法论层（`skills/`）的能力水位 —— 如果你走档 C，不如直接用 `skills/` 的通用评审协议，不必引入专家。

### §2.5 引用源映射表（无论哪档都要过一遍）

判据文件引用了一些**文件级外部物**。本专家只连带搬入了 `references/design.md`（admin 系判断层）；其余外部物按下表映射到你的项目——**不映射也能跑**，但未映射项会在评审时按 SKILL.md「引用缺失处理协议」降级，并在报告头列为覆盖缺口。

| 判据中的引用（web_system 原值） | 角色 | 你的项目填什么 | 不填的后果 |
|---|---|---|---|
| `packages/ui/src/tokens.ts` ↔ `tokens.css` | admin 系数值源 | 你的 token 定义文件路径 | F/G 组数值判定降级为建议 |
| `apps/kedou-ai-minigram/app.wxss` | 品牌端数值源 | 你的品牌端 token 文件；无品牌端则标 N/A | 品牌端数值判定降级为建议 |
| `rules/brand-interface/RULE.mdc` + `docs/ui/ui-design-spec.html` | 品牌端规范 | 你的品牌端规范文档；无品牌端则标 N/A | 品牌端细则冲突判定不做 |
| `ServiceManager.vue` 等参照页（`design.md` §1） | 密度/视觉基准 | **必填**：本项目每类页面各指定 1 个已过验收的参照页 | E5/E7 降级为建议 |
| `docs/ui/reviews/` | 评审报告落盘 | 你的评审目录；缺省与被审物同目录 | 无（有兜底） |
| `docs/ui/baselines/` | 截图基线目录 | 你的基线目录；缺省同上 | D3 截图并置无法归档 |
| `docs/ui/anchor-backlog.md` | 存量锚点清单 | 新项目通常 N/A（无存量） | 无（A4 仅适用存量回填） |

> 映射方式：填进 `design-system.local.md` 头部（档 B），或直接口头/任务上下文告知评审方（档 A）。**填一次，长期生效**。

---

## §3 门禁接线（三选一，从轻到重）

专家的价值靠机器强制兑现。三档任选，可逐步升级：

| 档 | 接线方式 | 效果 | 成本 |
|---|---|---|---|
| **L1 人工** | 无接线。每次改 UI 前主动调用 `@design-reviewer` | 靠自觉，会漏 | 零 |
| **L2 本地 git hook** | `commit-msg` 校验 UI commit 须带 `Design: pass` | 漏了会被拦 | 低（一个脚本） |
| **L3 CI + IDE hook** | CI 校验报告落盘 + 阻塞清零；IDE hook 拦 Write/Bash | 绕不过去 | 中 |

### L2 最小可用配置（可直接抄）

`.githooks/commit-msg`：

```bash
#!/usr/bin/env bash
# UI 源码改动须带 Design 凭证（评审已过且阻塞清零）
set -uo pipefail
MSG="${1:-}"
[ -n "$MSG" ] && [ -f "$MSG" ] || exit 0
[ "${UI_GATE:-}" = "off" ] && exit 0          # 应急出口

# ↓ 按你的项目改这两个模式
is_ui() {
  case "$1" in
    *.vue|*.jsx|*.tsx|*.wxml|*.wxss) return 0 ;;
    src/**/pages/*|src/components/*) return 0 ;;
  esac
  return 1
}

staged="$(git diff --cached --name-only --no-renames)"
has_ui=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  is_ui "$f" && has_ui=1
done <<EOF
$staged
EOF
[ "$has_ui" -eq 0 ] && exit 0
grep -qE '^Micro-exempt:' "$MSG" && exit 0     # 微调豁免

grep -qE '^Design:[[:space:]]*pass' "$MSG" || {
  echo "拒绝：本次含 UI 源码改动，commit message 缺 Design: pass" >&2
  echo "  先跑 design-reviewer 评审、阻塞项清零后再提交" >&2
  echo "  纯视觉微调改走 Micro-exempt: <理由>；应急用 UI_GATE=off" >&2
  exit 1
}
exit 0
```

启用：`git config core.hooksPath .githooks`（零依赖，不用 husky）。

### L3 额外接线

- **CI**：校验评审报告已落盘、且头部 `阻塞: 0`（报告模板见 `references/review-report-template.md`）
- **锚点机检**：原型打 `data-dr="<key>"`，实现侧同位置同名 → 用脚本比对漂移（判据 A1–A4）
- **IDE hook**：拦 Write / Bash 通道，防止绕过确认直接改 UI 源码

> web_system 的完整实现（含 `scan-design-drift.py`、`DESIGN_ANCHOR_MODE` 分档开关）见 `RATIONALE.md` §3，可作 L3 参考，但那是它的项目层配置，不在本专家交付范围内。

---

## §4 验证接入成功

按顺序自检，全绿才算接上：

| # | 检查 | 怎么验 |
|---|---|---|
| 1 | 判据可解析 | 评审时能指出 `E2` / `G4` / `S5` 这类编号，而不是"感觉不对" |
| 2 | 独立性生效 | 评审**先读判据再看产物**；不读出稿方的「设计决策记录 · 为什么这么设计」 |
| 3 | 报告可落盘 | 能产出报告，头部两行是机器可读的 `阻塞: N` / `重要: N` |
| 4 | 无判据项降级 | 指不到编号的意见出现在「建议」区并标注"个人偏好，可驳回" |
| 5 | 门禁生效（L2+） | 故意不带 `Design: pass` 提交 UI 改动 → **应该被拒绝** |

> 第 5 条最关键。**门禁不生效，专家就只是个会聊天的顾问。**

---

## §5 常见问题

| 问题 | 回答 |
|---|---|
| 评审说我阻塞，但产品已经确认方向了，能放行吗？ | 不能。沿用反模式 X1 —— 产品确认不替代设计评审，两者判的是不同维度 |
| 评审提的意见我不认可，怎么办？ | 报告里「建议」区（无判据编号）的可以直接驳回；带编号的是判据判定，要改的是判据本身或产物 |
| 评审会帮我改吗？ | 不会。专家只回流，改由出稿方做 —— 这是独立性机制的前提 |
| 小改动也要过评审吗？ | 不用。纯文案、单文件 ≤5 行微调走 `Micro-exempt: <理由>` |
| 我的项目没有双主题/双端，I 组判据怎么办？ | 在 `design-system.local.md` 里标注「不适用」，见 §2 档 B |

---

## §6 来源与版本

| 项 | 值 |
|---|---|
| 来源项目 | web_system（`web5/web_system`） |
| 判据来源 | `docs/ui/design-system.md` v1.0（2026-09-22），76 条 |
| 专家版本 | 见 `PROFILE.md` |
| 变更 | 见 `CHANGELOG.md` |
