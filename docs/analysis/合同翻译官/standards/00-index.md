# 尺子文档目录

> 每把尺子一份独立文档，产品/法务/技术三方共同维护。
> 模板：`_template.md`

## 通用尺子（`common.ts`）

| 文档 | 尺子 id | 名称 | 严重度 |
|---|---|---|---|
| `01-利率上限.md` | `usury-interest` | 利率上限 | danger |
| `02-砍头息.md` | `kickback-interest` | 砍头息 | danger |
| `03-提前还款违约金.md` | `early-repay-penalty` | 提前还款违约金 | warn |
| `04-定金上限.md` | `deposit-cap` | 定金上限 | warn |
| `05-违约金上限.md` | `penalty-cap` | 违约金上限 | warn |
| `06-强制搭售.md` | `force-bundling` | 强制搭售 | warn |
| `07-自动续费.md` | `auto-renew` | 自动续费 | warn |
| `08-格式条款.md` | `standard-clause` | 格式条款 | warn |

## 贷款场景尺子（`scenes/consumer-loan.ts`，新增）

| 文档 | 尺子 id | 名称 | 严重度 |
|---|---|---|---|
| `09-还款方式陷阱.md` | `repayment-scheme` | 还款方式陷阱 | warn |
| `10-月供合理性.md` | `monthly-payment-check` | 月供合理性 | warn |
| `11-提前还款时机.md` | `prepay-timing` | 提前还款时机 | warn |

## 基准库

| 文档 | 说明 |
|---|---|
| `market-benchmark.md` | 同类贷款市场利率区间（确定性数据） |

> 状态：通用 8 把已实现（代码在 `common.ts`）；贷款 3 把待实现（设计见 `02-贷款场景尺子设计.md`）。文档按需补齐。
