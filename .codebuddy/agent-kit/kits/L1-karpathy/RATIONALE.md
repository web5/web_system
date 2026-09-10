---
reviewed-at-version: 1.0.0
---

# RATIONALE · L1 行为纪律（人面）

## 为什么单独成层

Karpathy 的四条观察——不过脑子就假设 / 过度工程化 / 乱改无关代码 / 只管写不管对——针对的是**单次产出的行为质量**，与流程编排正交。若塞进流水线 skill 会带来两个问题：① 流水线体积膨胀，挤占常驻上下文；② 不走流水线的琐碎任务（改一行配置、写个一次性脚本）反而失去约束。独立成层后，任何代码动作都被覆盖，且体积可控。

## 为什么与 Superpowers / Anthropic 不冲突

三者作用域不同：

| 层 | 作用域 |
|---|---|
| L1 | 这一段代码怎么写（克制、精准、可验证） |
| L2 | 这个工程动作怎么做（TDD / 调试 / 验证） |
| L3 | 整个任务怎么组织（阶段、判据、人审） |

与另两部分的关系：历史上曾把 Superpowers 整体当作「第二套工作流」禁用（见 `scripts/uninstall-superpowers.sh`），代价是连 TDD 铁律、完成前验证、并行子 agent 一起丢掉。真实冲突面只有同属编排层的 4 个技能（brainstorming / writing-plans / executing-plans / spec-driven-development），其余是工程纪律。现行解法首选「补齐判据字段使其与主链同构」，整体卸载降为最后手段——见 `../../references/three-kits-architecture.md` §三 R1。

## 已知取舍

- **偏谨慎**：对一次性脚本、探索性原型会显得啰嗦。已在 SKILL.md 顶部声明「琐碎任务自行判断」，不追求教条执行。
- **Pushback 与满意度的张力**：反驳必须带代价量化（增加多少复杂度、换来什么），否则变成无依据的顶撞。
- **不覆盖非代码任务**：纯对话、文件整理、信息检索不走本层（由 L3 的类型化判据覆盖）。

## 来源

- 四条原则源自 Andrej Karpathy 对 LLM 编程常见失误的公开观察（X, 2026-01 帖子）。
- 回应四段式（Assumption / Changed / Verified / Risk）、删除安全、决策检查清单为本地叠加。
- 逐条来源与落点映射见 `../../references/three-kits-architecture.md` §2。
