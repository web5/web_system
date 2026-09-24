# 设计：INTERNAL_API_KEY 通过配置中心下发

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：把「服务间内部密钥」从「逐台人工写 `.env`」改为「配置中心作为权威源 + 部署时下发」。本文只做方案与判据，未落码。
> 上游：`specs/service-config-delivery/design.md`（配置下发总纲）、`docs/development/internal-api-key-runbook.md`（现状维护手册）
> 状态：**待拍板**

## 1 诉求与现状

**诉求**：`INTERNAL_API_KEY` 能在 deploy-console 里配置、按环境分层、有审计、可回滚 —— 而不是每台机器手工写 `.env`。

**现状**：8+ 个服务各写一份 `.env`，无审计、无环境分层、无轮换；凭据仓 `~/env_config` 里连留档都没有（见 runbook §6）。

## 2 关键事实：鸡生蛋在这个场景下**不成立**

这是本次设计的转折点，必须先把判据摆清楚：

| 来源 | 结论 |
|---|---|
| `specs/service-config-delivery/design.md:69` | 划界表把 `INTERNAL_API_KEY` 列为引导凭据，理由「鸡生蛋：读配置中心本身要先有它」 |
| `design.md:79-89`（候选方案对比） | 方案 **B（部署时下发）** 一栏明确写：**「鸡生蛋：不涉及（下发由平台主动推）」** |
| `design.md:83` | 只有方案 A（进程启动时**拉取**）才存在「拉取本身要凭据」 |
| `config.service.ts:43-53` | 代码侧 `RESERVED_LOCAL_KEYS` 确实包含 `INTERNAL_API_KEY`，注释沿用 §2 的理由 |

> **结论**：`design.md` 自己的方案对比已经承认 —— 走「部署时由平台主动推送写 `.env.generated`」这条路时，鸡生蛋不成立。
> 代码里的排除是**沿用了 §2 的表述**，并非推送路径下的真实阻塞。**这是个可以改的约束，不是物理限制。**

## 3 但有三个边界条件必须处理（否则会出事）

| # | 边界 | 说明 | 出处 |
|---|---|---|---|
| E1 | **deploy-console 自身不能走下发** | 控制台给自己写 `.env.generated` 会触发重启，而它的重启是**自杀式中断**；它只能「直接查配置中心」（持有 `CONFIG_MASTER_KEY`） | `design.md:95-102` |
| E2 | **首次启动 / 未部署时没有 `.env.generated`** | 此时服务仍能起来，但 internal 调用全 401（`InternalGuard` 未配置即拒绝）→ 必须有 `.env` 兜底 + 明确自检 | `internal-api-key-runbook.md` §7 |
| E3 | **远程下发通道的鉴权不得依赖该密钥** | 本地是 console 直接写文件；dev/prod 若经流水线脚本，脚本注入走 `resolveForScripts` 且**跳过 `is_secret=1`** → 密钥不会进脚本环境，需确认远程也是「console 写文件」而非「服务自拉」 | `local-dev-guide.md:234` |

## 4 候选方案

| | **方案 1（推荐·一期）放开过滤 + 双源兜底** | 方案 2 凭据分离 | 方案 3 密钥文件 | 方案 4 维持人工 |
|---|---|---|---|---|
| 做法 | 从 `RESERVED_LOCAL_KEYS` 移除该键（或加允许下发白名单）；配置中心按 env 存；部署时写 `.env.generated`；`.env` 保留兜底 | 新增专职「读配置」凭据（如 `CONFIG_AGENT_KEY` 或复用 `CONSOLE_TOKEN`），`INTERNAL_API_KEY` 降级为业务间凭据后自由下发 | 值不进 `.env`，走 0600 密钥文件 + 下发内容（对齐 `CONFIG_MASTER_KEY` P2 D1-D4） | 人工维护 + 指纹巡检脚本 |
| 解决「集中管理/审计/分层」 | ✅ | ✅ | ✅ | ❌ |
| 解决「可轮换」 | ⚠️ 需另加双值过渡 | ✅（业务凭据可随时换） | ✅ | ❌ |
| 改动量 | 小（过滤名单 + 文档 + 兜底说明） | 中（所有服务的配置读取鉴权要改） | 中大（服务侧支持文件读取） | 极小 |
| 风险 | E1/E2/E3（可控） | 新增一个引导凭据 | 与现有 dotenv 加载链并存 | 无（现状） |
| 与既有设计一致性 | ✅ 完全复用方案 B | 引入新概念 | ✅ 对齐主密钥 P2 | — |

### 推荐：**方案 1（一期）+ 预留方案 2**

- 你的核心痛点是「集中管理 + 有审计 + 按环境分层」，方案 1 用最小改动就给到；
- 「可安全轮换」是下一层需求，方案 1 里加**双值过渡**（`INTERNAL_API_KEY` + `INTERNAL_API_KEY_OLD`）即可覆盖，不必先做凭据分离；
- 方案 2 留作演进：当出现「轮换要零停机且不能重启」的硬需求时再做。

## 5 方案 1 的配套改造清单（落码时才做）

1. `config.service.ts`：把 `INTERNAL_API_KEY` 从 `RESERVED_LOCAL_KEYS` 移除，注释改为「可下发；`.env` 仅作首次启动兜底」。
2. `design.md` §2 划界表：把该键从「引导凭据」移到「业务/服务间凭据」，并注明**前提是走部署时推送（方案 B）**。
3. 服务侧启动自检：internal 调用失败时明确区分「未配置」「不匹配」「对端未配置」（现状只报 `internal forbidden`，极易误判）。
4. 控制台侧：该键标记为 `is_secret=1`（加密落库、掩码回显、审计只记 hash）—— 能力已具备，只需登记。
5. 文档：`internal-api-key-runbook.md` 更新为「配置中心为权威源，`.env` 为兜底」。

## 6 验收判据（EARS）

- [ ] WHEN 在控制台为某环境设置 `INTERNAL_API_KEY` THE SYSTEM SHALL 加密落库并掩码回显，审计不记明文
- [ ] WHEN 触发一次部署/重启 THE SYSTEM SHALL 把解析结果写入 `servers/<svc>/.env.generated` 并**在下发后再重启**，保证重启即读到新值
- [ ] IF 该键属于 deploy-console 自身 THEN THE SYSTEM SHALL **不写 `.env.generated`**，改为部署时直接查配置中心（避自杀式重启）
- [ ] IF 删除 `.env.generated` THEN THE SYSTEM SHALL 回退到 `.env` 的兜底值（天然回退开关）
- [ ] IF 服务启动时读不到该键 THEN THE SYSTEM SHALL 在首次 internal 调用失败时报出**可区分**的错误（未配置 / 不匹配），而不是笼统 401
- [ ] WHEN 不同环境设置不同值 THE SYSTEM SHALL 按 envId 解析，互不串扰

## 7 待拍板

- [ ] **Q1**：接受方案 1 吗？（含「console 自身例外，仍人工维护」这一条）
- [ ] **Q2**：一期就要**双值过渡轮换**能力，还是先只做下发？
- [ ] **Q3**：dev 与 prod 是否用不同值？（推荐：是）
- [ ] **Q4**：远程（dev/prod）下发确认是「console 写文件」路径吗？若是「服务自拉」，则回退到方案 2 才成立
