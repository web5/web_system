<!--
  这张模板只干一件事：把「哪些检查会拦、哪些只是提示」写进每张 PR。
  口径来源：docs/development/gates/01-日常使用.md §阻断力真相。
  刻意保持短——模板一长，人就开始删它。
-->

## 关联 Issue

<!--
  分支名带编号（fix/123-xxx、feature/123-xxx）时，auto-pr 会自动填 Closes #123，本节可留空。
  没开 issue 的写：无 issue —— <一句为什么不必开>（判据见 docs/development/issue-workflow.md §1，
  只有「十分钟说完 + 一次改完 + 不需要发布方案」三条全中才允许）。
  ⚠️ 只有 Closes/Fixes #N 才会自动关单，写「见 #123」不会关。
-->

Closes #

## 改了什么

<!-- 一段话说清。涉及发布/数据变更的，链接到研发方案 §5 发布清单。 -->

## 门禁 / 体检项

| 类别 | 含义 | 本次 |
|---|---|---|
| **门禁**（会阻断） | R1–R4 调试·凭据·占位·TS 铁律 · R11 设计评审 · 原型三件套 · L1/L5/L9 流水线 · build/test/lint | CI 全绿即通过 |
| **体检项**（只提示） | R5 R8 R9 R9b R10 R13 R14 R15 R16 R17 R18 · L6 | 有输出请贴摘要 + 一句「为何可接受」 |

> 别把两者混称「全部检查通过」——体检项恒绿不代表没问题。

## 凭证（命中才填，没命中删掉这一节）

| 触发面 | 需要的 trailer |
|---|---|
| 改了 UI 源码 | `Proto: <原型 commit sha>` + `Design: pass` |
| 改了迁移 / `packages/types` / MCP 工具 / 对外 controller | `Contract: pass` |
| 改了 `ecosystem` / 服务 `.env` / 流水线脚本 / CI workflow | `Release: pass` |
| 新增对外接口 | `Code: pass` |
| 新增业务源码 | `Test: pass` |
| 新增 service / controller / 前端 view | `Plan: pass` |

## 豁免（用了才填，没用删掉）

| 出口 | 理由 | 为什么不能再小 |
|---|---|---|
| `Micro-exempt:` / `UI_GATE=off` / `--no-verify` | | |

## 发布影响

- [ ] 无（纯文档 / 纯脚本 / 纯内部重构）
- [ ] 有 → 发布清单见：<!-- 路径 -->，回滚方案见：<!-- 路径 -->
