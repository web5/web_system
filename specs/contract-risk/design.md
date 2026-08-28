# 合同翻译官 · 阶段一设计

## 1. 架构定位

```
packages/shared/src/contract/
├── index.ts              # re-export
├── types.ts              # 标准库 & IRR 类型
├── irr.ts                # IRR / APR / 贷款分析 纯函数
└── standards/
    ├── index.ts          # getStandards() / matchByText() / getByScene()
    ├── common.ts         # 通用尺子（利率上限/砍头息/违约金/定金/格式条款…）
    └── scenes/           # 场景专用尺子
        ├── consumer-loan.ts
        ├── car-loan.ts
        ├── medical-insurance.ts
        └── ...
```

## 2. 关键模块设计

### 2.1 IRR 计算（irr.ts）
- 采用**二分法 + 牛顿迭代**求内部收益率（IRR）。
- `npv(rate, cashflows)` 净现值函数，现金流约定：`positive = 收入（借款到手）`，`negative = 支出（每月还款）`。
- `calculateIRR(cashflows, guess=0.1, maxIter=100, tol=1e-7)`：
  - 处理符号翻转：至少一个正 + 一个负，否则抛错。
  - 牛顿迭代若不收敛，退化为二分法（在 [-0.999, 1] 区间搜索），保证有解。
- `analyzeLoan`：
  ```
  monthlyRate = 由月供反推（若给了月供）
  apr = ((1+monthlyRate)^12 - 1) * 100   // 有效年化（复利）
  totalPayment = monthlyPayment * periods
  totalInterest = totalPayment - principal
  若含 upfrontFee：effectivePrincipal = principal - upfrontFee，用于计算实际利率
  ```
- 纯函数、无副作用、无 any。

### 2.2 标准库（standards/）
- `getStandards(): LegalStandard[]` 返回全部。
- `getByScene(scene): LegalStandard[]` 按场景过滤。
- `matchByText(text, scene?): Array<{ standard, matchedKeyword }>` 文本命中初判（AI 之前的第一道闸）。
- 每个尺子用**关键词/正则**做初判，LLM 只做"定位 + 话术生成"，确保"能用规则算的绝不用 AI 算"。

### 2.3 标准库 v1 清单（9 核心尺子）
通用：
1. `usury-interest` 利率上限（>24% 保护线，>36% 可主张返还）— danger
2. `kickback-interest` 砍头息（利息预扣/服务费前置）— danger
3. `early-repay-penalty` 提前还款违约金（>3% 或前 N 期禁止提前还）— warn
4. `deposit-cap` 定金上限（>20% 无效）— warn
5. `penalty-cap` 违约金上限（>30% 可请求酌减）— warn
6. `force-bundling` 强制搭售/默认勾选 — warn
7. `auto-renew` 自动续费未显著提示 — warn
8. `standard-clause` 格式条款（免除己方责任未尽提示）— warn

场景专用（医疗险）：
9. `insurance-waiting-period` 等待期/免责条款（长期重疾等待期过长、免责表述模糊）— warn

## 3. 约定（遵循项目铁律）
- shared 包：TS strict、无 any、无副作用纯函数。
- shared 内不得 import `@web-system/shared` 自身（无循环依赖）。
- 新增标准必须注册进 `standards/index.ts`。
- 导出在 `packages/shared/src/index.ts` re-export。

## 4. 测试策略
- IRR 模块：单测覆盖正/负现金流、前置费用、边界、非法输入。关键用例对照手算标准值。
- 标准库：单测验证 matchByText 命中、id 唯一、字段完整性。
