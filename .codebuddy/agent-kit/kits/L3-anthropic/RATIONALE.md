---
reviewed-at-version: 1.0.0
---

# RATIONALE · L3 协作主干（人面）

## 为什么只保留一个编排入口

两个都能决定「任务怎么分阶段」的东西并存时，Agent 会在「环境里正好有」时改走另一套，导致判据链被架空——表现为「执行过程中设计时看不到交付验证」。这是**同层竞争**问题，与 L1/L2 无关（它们不产出阶段结论）。

因此唯一的只是「编排权」：同样只有一个入口（`rd-digital-agent`）、判据仍然只有一份（`V1…Vn`）。

## 为什么不主张整体卸载第二套技能

历史上为排除 Superpowers 的编排类技能，`scripts/uninstall-superpowers.sh` 一次卸载 20 个，代价是连 TDD 铁律、完成前验证、并行子 agent 一起丢掉。冲突面只有 4 个编排类技能，卸载面却是 20 个——误伤远大于收益。

现行优先级：**补齐宿主流程模板的判据字段（使其与主链同构）→ 同域同名以 rd-* 为准 → 万不得已才整体卸载**。详见 `../../references/three-kits-architecture.md` §三 R1。

## 为什么 L3 只做指针、实体留在 skills/

`skills/rd-digital-agent` 及其 13 个子技能、`rules/general` 五条红线已稳定运行，并被 `eval-gate`（S1–S9）与 `scripts/sync-to-target.sh` 依赖。搬移会同时破坏 CI 检查与同步链路，收益为零。L3 入口只承担「定位 + 编排权 + 调用关系」，实体保持单一真相源。

## 三部分的互不替代

| 失效形态 | 缺哪部分 |
|---|---|
| 判据写得很全，但代码过度设计、顺手改了无关文件 | L1 行为准则 |
| 流程走了，但测试后补、bug 靠猜、完成靠「应该没问题」 | L2 执行手段库 |
| 每一步都很规范，但没有判据、没人审、产物不落盘 | L3 协作主干 |

## 来源

方法论主张与 Anthropic *Best practices for Claude Code* 的对应关系、逐层落点审计见 `../../references/anthropic-workflow-mapping.md`；三部分的咬合关系与风险消解见 `../../references/three-kits-architecture.md`。
