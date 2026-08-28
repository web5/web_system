# 合同翻译官 · 阶段一实施清单

> 依赖关系：1 → 2 → 3（IRR 无依赖标准库，可并行；标准库依赖类型定义）。

## 任务清单

- [ ] **T1. shared 类型定义**（`packages/shared/src/contract/types.ts` + `index.ts`）
  - 定义 `LegalStandard`、`ContractScene`、`LoanAnalysis`、IRR 函数签名
  - 在 `packages/shared/src/index.ts` re-export
  - 依赖：无

- [ ] **T2. IRR 计算模块**（`packages/shared/src/contract/irr.ts`）
  - `calculateIRR` / `analyzeLoan` / 净现值函数
  - 二分法 + 牛顿迭代，边界处理
  - 依赖：T1
  - 验收：对照 spec/requirements.md IRR 用例

- [ ] **T3. 标准库 v1**（`packages/shared/src/contract/standards/`）
  - `common.ts` 通用 8 尺子 + `scenes/medical-insurance.ts` 等待期尺子
  - `index.ts` 的 `getStandards/getByScene/matchByText`
  - 依赖：T1
  - 验收：spec 标准库用例

- [ ] **T4. shared 构建验证**
  - `pnpm --filter @web-system/shared build` 通过
  - 依赖：T2, T3

## 验收关联
- T2 → requirements.md「IRR 模块」节
- T3 → requirements.md「标准库」节

## 后续（阶段二，不在本次范围）
- ai-service `contract` 模块：controller/service/dto/entity（对接标准库 + LLM + OCR）
- 小程序页面：首页/上传/解读中/结果（风险信号）
- 输出护栏、数据飞轮
