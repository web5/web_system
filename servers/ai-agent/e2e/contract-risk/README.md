# 合同翻译官 · 端到端质量评测（E2E Eval）

> 评测对象：`contract-risk` Agent（servers/ai-agent/src/contract/），含 4 工具
> （contract-cleaner / contract-rule / contract-irr / contract-benchmark）+ 报告快照链路。
> 方法论对齐：`.codebuddy/agent-kit/references/eval-framework.md`（L4 端到端质量评测 · 任务卡法）。
> 状态：**样本已定稿（fixtures/，7 份）+ checker 判定已实现（零 token 单测 17 例通过）**；
> run-eval 真实装配（连 LLM）待做。

## 0. 一句话定义

```
固定合同样本文本 → AgentRunner(真实 LLM + 4 真实工具) → final JSON → parseContractReport
→ 四组判定：① 字段全（机器）② 数值准（对账）③ 红线净（合规）④ 工具链（决策 D）
→ 逐样本 PASS/FAIL → 汇总报告（通过率 + 趋势对比）
```

评测测的是 **「加载了真实 systemPrompt + 真实工具的 agent 的产出」**，不是 parser、不是 service——
它们是各自的单测（`*.spec.ts`）在测的事。

## 1. 四组判定（评分内核）

| 组 | 判定方式 | 查什么 | 可调开关（types.ts / manifest.ts 注释） |
|---|---|---|---|
| **G1 字段全** | 机器 | 必填字段、signals/rights 非空、scene 合法 | `expectSignalIds` / `expectSignalLevels`(决策A) / `maxSignalLevel`(决策C) / `rightsMin`(决策E) |
| **G2 数值准** | 机器现算对账 | keyNumbers/loanPlan vs `analyzeLoan` 现算期望（± 容差） | `truth.loan` 参数；APR 容差常量在 checker.ts |
| **G3 红线净** | 机器 | 全字段禁词扫 + disclaimer 特征短语 | `redlineForbidden` / checker 内特征串 |
| **G4 工具链** | 机器 | 真实调用过该调的工具、顺序合规（决策 D） | `expectToolCalls` / `expectToolOrder` / `requireToolUse` |

**通过线（一票否决）**：四组全 PASS 才算该样本通过。
G1/G2 任一不过 → FAIL，不以总分豁免（数值错 = 护城河崩，对齐 eval-framework §2）。

> 可选扩展：G3 之上叠加 LLM-as-judge 复核开放性问题（如"是否只解读不推荐"），
> judge 与 agent 必须隔离会话。当前只做机器判定，减少偏置。

## 2. 样本集（golden fixtures）

位置：`e2e/contract-risk/fixtures/`。
结构：`fixtures/texts/<id>.txt`（固定合同文本，独立成文件便于审阅）+ `fixtures/manifest.ts`（清单 + ground truth）。
草稿与决策记录：`fixtures/DRAFT-samples.md`（A~E 结论已落 manifest，历史原因保留）。

样本清单（7 份，DRAFT-samples.md 有逐份审核要点）：

| # | id | 场景 | 验证意图 |
|---|---|---|---|
| S1 | consumer-loan-01 | 消费贷款 | 高息(IRR 41.3%)+砍头息+强制搭售 |
| S2 | car-loan-01 | 购车贷款 | 提前还款违约金+锁定期 |
| S3 | car-finlease-01 | 购车融资租赁 | 格式条款+30%违约金+留购价 |
| S4 | medical-insurance-01 | 医疗保险 | 等待期+免赔额 |
| S5 | rental-01 | 租房 | 押金超20%+房东免责 |
| S6 | consumer-loan-clean-01 | 消费贷款(对照) | 不乱报 danger、仍给 ok 信号+通用权益 |
| S7 | consumer-loan-01-ocr | 消费贷款(OCR) | 触发 cleaner → rule 链路 |

**样本规则（一经固定不得修改）**：同前版——真实感长文、定稿冻结、期望值现算不手拍、truth 必给禁词表。
改文本 / 改 truth = 换基准 = 基线重置（见 §6）。

## 3. 目录结构

```
e2e/contract-risk/
├── README.md                  # 本文（运行手册）
├── types.ts                   # 公共类型 + 可选断言字段说明
├── fixtures/
│   ├── DRAFT-samples.md       # 样本草稿与 A~E 决策记录（历史）
│   ├── manifest.ts            # 正式清单（7 样本 + ground truth）
│   └── texts/<id>.txt         # 合同正文
├── checker.ts                 # 四组判定纯函数（已实现）
├── checker.spec.ts            # 判定单测（零 token，17 例）
├── run-eval.ts                # 运行器（--dry 可用；真实 run 待装配）
├── report.ts                  # 报告渲染 + 汇总
└── ../jest.config.js          # e2e 单测 jest 配置
```

报告落盘：`.codebuddy/evals/reports/contract-risk/<YYYY-MM-DD>/<roundDir>.md`。
模板：`.codebuddy/evals/reports/contract-risk/TEMPLATE.md`。

## 4. 怎么跑

```bash
cd servers/ai-agent

# ① 判定逻辑单测（零 token，改 checker 必跑）
pnpm test:e2e

# ② 样本自检（零 token，改样本必跑；确认 7 份都加载成功）
npx ts-node e2e/contract-risk/run-eval.ts --dry

# ③ 真实评测（需服务配置提供真实 LLM：TOKENHUB_MODELS 对应模型 + 凭据）
npx ts-node -P tsconfig.json e2e/contract-risk/run-eval.ts --round 001 --model deepseek-v4-pro
```

真实 run 待做清单（README §7 步骤 3）：
1. Nest `Test.createTestingModule` 装配 `AgentModule`（复用线上 provider 工厂），注入 `AgentRunner`；
2. 逐样本 `agentRunner.stream({ agentId: 'contract-risk', userInput })`，收集 tool_call/result/final + usage；
3. `parseContractReport(final)` → `checker.evaluateRun` → 汇总 → 报告落盘。
> 建议每次 run 用独立 userId / conversationId，不污染真实业务库。

## 5. 评分与回归判据

- **通过率** = 通过的样本 / 总样本；逐样本含 G1~G4 明细供人工抽检。
- **成本**：记录 totalTokens + durationMs，报告里单列（防"变好但贵 3 倍"被掩盖）。
- **回归判定**（对齐 eval-framework §5）：任一指标相对上版下降 → 判退化，本次 agent 改动不合并：
  - 通过率下降；
  - G1~G4 任一通过率下降 ≥ 0.1；
  - token 成本均摊上涨 ≥ 50%（带宽级变化需说明理由）。

## 6. 防漂移四闸（对齐 eval-framework §4）

1. **输入冻结**：样本文本 / truth 改 = 基线重置，报告头标注 new-baseline；
2. **Rubric 冻结**：本文 §1 判定组与通过线、以及 types.ts 可选开关的默认值改动 = rubric 重置，需标注；
3. **judge 隔离**：若引入 LLM-judge，与被测 agent 不同会话；
4. **多轮取均值**：LLM 有随机性，正式跑建议每样本 2 轮（run-eval 支持 `--rounds N`）；
5. **报告只追加不改写**：历史报告是回归证据，落盘后不改。

## 7. 落地路径

1. ✅ 骨架目录 + 类型 + 判定函数签名 + 报告模板
2. ✅ 7 份样本定稿（fixtures/texts + manifest.ts，数值现算）+ 判定实现（checker）+
    零 token 单测 17 例（`pnpm test:e2e`）与 `--dry` 自检
3. ⏳ 写 run-eval 真实装配与运行（连真实 LLM）
4. ⏳ 首份基线报告（无基线无趋势）
5. ⏳ 后续每个 agent 行为变更 → 跑 → 对比报告 → 决定合并


## 8. 配套

- Agent 定义：`servers/ai-agent/src/contract/agents/contract-risk.agent.ts`
- 报告解析：`servers/ai-agent/src/contract/contract-report.parser.ts`
- IRR/标准库：`packages/shared/src/contract/`
- 评测方法论：`.codebuddy/agent-kit/references/eval-framework.md`
- kit-gate 约定：改动 `.codebuddy/skills/`、agent-kit 行为定义才触发；**业务 agent 评测不触发 kit-gate**，报告独立落 `.codebuddy/evals/reports/contract-risk/`。
