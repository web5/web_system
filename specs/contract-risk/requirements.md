# 合同翻译官 · 阶段一地基 Spec

> 范围：IRR 精确计算模块 + 法定标准库 v1（消费贷/购车/医疗险）
> 版本：v1.0 · 2026-08-26
> 关联文档：`docs/products/合同翻译官/护城河与建设指南.md`

## 1. 目标

把"算得准"的地基做扎实：
1. **IRR 计算模块**：真实年化利率/费用测算，**100% 准确**（纯函数、严格单测）。
2. **法定标准库 v1**：3 场景 × 9 核心尺子，结构化标准（识别特征 + 法定依据 + 话术 + 严重度 + 3步操作）。

## 2. 放置位置决策

遵循项目规范「跨端配置禁止拷贝，必须收口到 `@web-system/shared`」：

| 模块 | 位置 | 理由 |
|------|------|------|
| IRR 纯函数 | `packages/shared/src/contract/irr.ts` | 前端小程序即时预览 + 后端测算共用，必须收口 |
| 法定标准库 | `packages/shared/src/contract/standards/` | 内容资产，前端展示 + 后端判定共用 |
| 类型定义 | `packages/shared/src/contract/types.ts` | 统一类型 |

> 注意：shared 是纯 TS 包（已配置 strict + noImplicitAny），新增代码不得引入 any。

## 3. 数据模型设计

### 3.1 标准库（尺子）结构
```ts
interface LegalStandard {
  /** 唯一标识，如 'usury-interest' */
  id: string;
  /** 所属场景 */
  scene: ContractScene;          // 'consumer-loan' | 'car-loan' | 'medical-insurance' | 'car-insurance' | 'rental' | 'other'
  /** 风险严重度 */
  level: 'danger' | 'warn' | 'ok';
  /** 尺子名称（内部） */
  name: string;
  /** 识别特征：关键词/正则，用于规则命中（不用 AI 也能初判） */
  patterns: string[];
  /** 法定依据：条文引用 */
  legalBasis: { law: string; article: string; quote: string };
  /** 用户话术：风险信号标题模板（可含 {placeholder}） */
  signalTitle: string;
  /** 一句话大白话结论 */
  plainText: string;
  /** 3 步操作 */
  actions: string[];
  /** 术语解释 */
  termExplain?: string;
}

type ContractScene = 'consumer-loan' | 'car-loan' | 'medical-insurance' | 'car-insurance' | 'rental' | 'other';
```

### 3.2 IRR 计算接口
```ts
// 现金流法（等额本息场景）
function calculateIRR(cashflows: number[]): number;          // 内部收益率
function calculateAPR(...): number;                           // 年化利率
// 一次性费用摊入场景
function effectiveRate(amount, fee, periods, monthlyPayment): number;
// 贷款分期场景便捷封装
interface LoanAnalysis {
  monthlyRate: number;   // 月费率
  apr: number;           // 实际年化（含全部费用）
  totalPayment: number;  // 总还款
  totalInterest: number; // 总利息（含费用）
}
function analyzeLoan(params: { principal; upfrontFee; periods; monthlyPayment }): LoanAnalysis;
```

## 4. 验收标准（EARS）

### IRR 模块
- When 输入"本金 10 万、月供 5000、12 期、无前置费用"，系统应返回年化约 0%（月费率 0）
- When 输入"本金 10 万、前置服务费 5000、月供 5000、12 期"，系统应把前置费用计入，年化 > 名义月费率
- When 输入月费率 1.5%、分期 12、含 5000 前置费，系统应算出年化 ≈ 36%（对照标准值）
- When 现金流方向不全为正或不全为负（至少一个正一个负），系统应正常计算
- When 输入非法（期数≤0、金额≤0），系统应抛错而非返回 NaN

### 标准库
- When 遍历全部标准，系统应保证每个标准 id 唯一、scene 合法、actions 非空
- When 文本含"利息不得预先扣除"，系统应能命中"砍头息"尺子
- When 文本含"月费率 1.5%"，系统应能命中"利率"相关尺子
- When 文本含"提前还款 3% 违约金"，系统应命中"提前还款违约金"尺子
