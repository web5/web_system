# _template · 专家实例模板

> 复制本目录为 `experts/<expert-name>/` 后逐项填写。
> 七维定义的完整方法论见 `../../references/agent-definition-methodology.md`；
> 填空模板见 `../../references/agent-definition-template.md`（第 1 号实例样例在其附录 A）。

## 必备文件（缺一即不完整）

| 文件 | 内容 | 提示 |
|---|---|---|
| `PROFILE.md` | 七维画像：0 命名 / 1 定位意图 / 2 特征风格 / 3 输入边界 / 4 工作流 / 5 能力集 / 6 红线机器化 / 7 上下文策略 / 8 评测交付物 / 9 定稿辨证 | 每维都要**可评测**，写不出评测手段的维度说明还停在形容词层 |
| `SKILL.md` | 可执行部分：frontmatter（name/version/rationale/adopt/loads）+ 职责 + 边界 + 机制 + 工作流 + 不做什么 | AI 的执行入口；不受 `skills/` 的 150 行限制，但仍宜精简 |
| `ADOPT.md` | ★ 本层独有：§1 需提供什么 / §2 判据怎么换（三档）/ §3 门禁接线（L1–L3，含可直接抄的配置）/ §4 验证接入成功 / §5 FAQ | **没有 ADOPT.md 的专家 = 跑不起来的空壳** |
| `references/` | 判据、清单、模板 | 项目可用 `*.local.md` 覆盖，同步永不冲掉 |
| `RATIONALE.md` | 设计理由 + 返工教训 + 参考接线 | 人面，不在执行路径；`reviewed-at-version` 锁版本 |
| `CHANGELOG.md` | 版本变更 + 何时需重新 adopt | 见 Q12 |

## 准入自检（入驻前四条全中）

- [ ] ≥3 次真实使用（有落盘产出物）
- [ ] 完整判据源（条目级可裁决）
- [ ] 有门禁（机器或人工，能拦住违规）
- [ ] 至少一个项目在用

## 入驻后同步清单

- [ ] 更新本 README 的「当前专家」表
- [ ] 更新 kit 顶层 `README.md` 目录结构（提及 `experts/`）
- [ ] `scripts/sync-to-target.sh` 同步清单已含 `experts`（已配置）
