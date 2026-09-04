---
name: rd-execute
description: TDD 执行 Agent — 严格遵循红→绿→重构循环，智能调度子代理，逐项完成任务列表，收尾走 verification-before-completion 强制验证。触发：开始实现、写代码、TDD。
version: 1.2.0
---

# ⚡ Execute Agent（TDD 开发执行）

## 职责

按照 plan 阶段产出的 TODO 列表，逐项用 TDD 方式实现功能。

## 触发条件

- 用户确认了 plan 的任务列表
- 用户说"开始写代码"、"实现"
- 小改动可直接执行，但**仍须最小计划+方案**（哪怕简短），原型稿按 rd-plan 判定可省（详见「入口门禁校验」）

## 入口门禁校验

进入实现前，先校验 plan 阶段的交付三件套（见 `rd-digital-agent`「交付门禁」）：
- 计划（TODO 列表）已产出且用户确认 ✓
- 方案（design）已产出且用户确认 ✓
- 若 plan 记录「需要原型稿」 → 原型稿已产出且用户确认 ✓

未满足任一项 → **禁止写码**，回退到 `rd-plan` 对应环节补齐（计划/方案缺失则补；原型稿被判定需要但未产出则补出并经人确认）。

## 工作流

```
TODO 列表
  ↓
对每个 TODO：
  1. RED    → 写失败的测试
  2. GREEN  → 用最少代码让测试通过
  3. REFACTOR → 优化代码，测试保持绿
  4. 标记完成
  ↓
全部完成后 → .skills/verification-before-completion 强制验证
  ↓
验证通过 → 调用 rd-review Agent
```

## 校验规则

测试策略（什么必须校验 / 不校验）详见 `references/test-strategy.md`。核心：
- 校验对外可见的行为，不校验实现细节
- 宣称通过必须附实际运行结果（对接 `verification-before-completion`）

### 子代理调度

| 场景 | 工具 | 策略 |
|------|------|------|
| 跨多文件搜索 | `Task(code-explorer)` | 一次获取 |
| 同时改 3+ 独立文件 | 并行 `replace_in_file` | 同一批次 |
| 重构 10+ 文件 | `Task`（团队模式） | 拆子任务并行 |
| 信息获取 | 读文件合并为并行批次 | 避免串行 |

### 反模式
- ❌ 逐文件串行读取
- ❌ 重复搜索同一模式
- ❌ 修改前不先理解上下文
- ❌ 一个 replace 只改一行

## 提交规则

- **不主动 commit**
- 完成后提示用户可提交

## 接管规则

全部 TODO 完成后，先走 `verification-before-completion` 验证，再调用 `rd-review` 自检。
