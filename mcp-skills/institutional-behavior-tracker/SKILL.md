---
name: web-system-institutional-behavior-tracker
description: 机构行为全周期追踪框架——中线投资决策SOP。用于分析A股个股的机构持仓、北向资金、资金流向、龙虎榜席位、筹码分布等数据，执行"选股→持股→离场"完整闭环决策。本技能为 web_system / MCP 环境适配版：候选发现映射到 kedouai MCP `finnews`，四维硬数据映射到 kedouai 自托管 MCP `institution`（北向/资金流/龙虎榜/估值/研报/评级，免连接器授权），分析严格遵循"双通道并行 + 候选池确定性锁定 + 决策面板三档"。当用户（或定时任务）需要分析个股机构行为、判断买卖时机、执行投资纪律检查时加载本技能。
version: 2.4.0
agent_created: true
---

# 机构行为全周期追踪框架（web_system / MCP 适配版）

## 定位

**选股层** SOP，适用中线持股（1-6个月）。核心方法是通过**四维验证**（静态仓位、动态行为、成本估值、北向资金）交叉判断机构意图，双通道选股（正向四维 + 反向雷达），并设置系统化离场条件。

> V2.3：选股双通道（正向四维验证 + 反向雷达回调强势票扫描），报告统一采用决策面板三档格式。
> V2.4：选股候选池确定性锁定——禁止裸脑选股、固定扫描条件、固定排序截断、快照锁定，解决开放式选股结果漂移问题。

## 适用场景

- 分析个股机构持仓变化与资金流向
- 分析北向资金（外资）持股与净买卖动向
- 判断个股买入/卖出时机
- 执行投资纪律检查与排雷
- 生成个股机构行为分析报告
- **定时任务驱动**：如"未来一周关注公司"每周扫描，对候选公司套用本框架输出决策面板

## 核心逻辑：四维验证法

投资完整周期：**选股 → 持股 → 离场**。

| 维度 | 解决的问题 | 一句话 |
|---|---|---|
| 静态仓位 | 能不能买（方向） | 机构持了多少 |
| 动态行为 | 什么时候买（时机） | 机构正在做什么 |
| 成本与估值 | 值不值得赌（盈亏比） | 机构是否比你便宜 |
| 北向资金 | 增量确认（条件启用） | 外资在买还是在卖 |

> 维度四仅当该股为沪深港通标的时启用；小盘股/次新股退化为三维验证。

完整操作标准、阈值、数据源见 `references/framework_v2.md` 第二章。

## 操作流程

### 第〇步：使用前强制检查（漏一项即停）

> ⚠️ 每次选股必须**双通道并行**跑完，缺一即分析不完整、结果作废：

1. **通道 A（正向四维验证）**：静态仓位 → 动态行为 → 成本估值 → 北向资金
2. **通道 B（反向雷达）**：抓「基本面强 + 机构温和加仓 + 股价回调」的潜力票

> 教训（2026-08-13）：曾只跑通道 A，漏掉海光信息（688041）这类回调蓄力票。**通道 B 不可省略。**

### 第一步：5分钟排雷（使用前必须执行）

1. 业绩排雷：最新季度营收和净利润同比增速是否 > 20%？
2. 估值排雷：当前PE是否处于行业历史中位数合理区间？
3. 消息面：近1个月是否有重大利空？

> 若基本面严重不达标，四维验证完全失效，应直接放弃。

### 第二步：选股（双通道）—— 候选池确定性锁定 ⭐ V2.4

**四条铁律**：
1. **禁止裸脑选股**：候选池必须来自数据工具扫描结果（finnews 板块热度+个股资讯 / institution 四维硬数据），禁止不调工具、仅凭记忆罗列股票。工具返回空 → 如实报"未找到符合条件的股票"，禁止编造代码/名称。
2. **固定扫描条件**：通道A/B 按固定条件扫描，不得临时改条件、改范围、改市场。
3. **固定排序截断**：扫描结果按指定字段排序取前 N 只，锁定为候选池快照。
4. **快照锁定**：候选池一经产出，本次分析全程以该名单为唯一输入；评级过程中禁止追加、替换、删除任何票。

**确定性扫描指令**：

| 通道 | 固定扫描条件 | 推荐工具 | 排序/截断 |
|---|---|---|---|
| A 正向四维 | 机构持仓>15% 或 社保/大基金/顶级外资新进 | kedouai MCP `institution`（北向/资金流/龙虎榜/估值/评级） | 按北向持仓或资金流强度降序，取前20 |
| B 反向雷达 | 营收/净利增速>40% 且 距60日高点回撤>20% | kedouai MCP `institution` + `finnews` | 按回撤幅度降序，取前20 |

- **通道A**：四维验证，抓"机构正在建仓/拉升初期"的票
- **通道B**：反向雷达，抓"基本面强+机构温和加仓+股价回调"的潜力票

**web_system / MCP 环境下的候选来源（二选一或叠加）**：
- **kedouai MCP · finnews**（`//kedou-mcp-curl` 调 `finnews` 模块）：`get_sector_library` → `get_sector_hot` → `get_stock_news` → `get_market_pulse`，用"板块热度上升 + 个股实质利好资讯"作为候选公司的**初筛与催化面证据**（注意：finnews 提供的是资讯/情绪/热度，不提供机构持仓原始数据，仅作候选发现，不替代四维验证）。
- **kedouai MCP · institution**（`//kedou-mcp-curl` 调 `institution` 模块，自托管免授权）：`get_north_holding` / `get_fund_flow` / `get_lhb` / `get_valuation` / `get_report` / `get_rating` 覆盖北向、资金流、龙虎榜、估值、研报、评级等四维硬数据。

> 若工具不支持某维度（如"机构持仓比例"），用等效数据源/条件替代，但**必须把实际使用的条件写进报告**，保证可复现。
> 输出可追溯：扫描类报告开头必须注明「候选池来源：XX工具 + 条件 + N只 + 扫描时间」。

通道B条件组、估值处理规则、评级归属见 `references/framework_v2.md` 第二章第五节。

### 第三步：综合评级与建仓

四维验证结果 → S级（黄金坑）/ A级（趋势中）/ C级（危险）/ 观察级。评级矩阵与修正规则见 `references/framework_v2.md` 第三章。

### 第四步：持仓监控与离场

- **四大高危时间窗口**：4月底、8月底、10月底、12月中-1月初
- **三大致命盘面信号**：高位放量滞涨、低位筹码向上转移、大单托底却不涨
- **离场条件矩阵**（A-E）：触发1项减仓1/3，触发2项+清仓

详细矩阵与散户反向指标见 `references/framework_v2.md` 第四章。

## 数据调用方式（硬性约定：一律 curl 直调 kedouai 端点）

> ⚠️ **自动化任务里没有 WorkBuddy MCP 工具 / 金融连接器可用**（tdx/mx-ds 需授权加不了、westock 项目列表无）。**本技能在自动化中取数的唯一方式是 curl 直调 kedouai 生产 MCP 端点**，即通过 `//kedou-mcp-curl` 技能的 `mcp_call(module, tool, args)` 完成（curl + JSON-RPC，内部自动处理 Mcp-Session-Id 与 SSE 解析）。
>
> **禁止**在分析流程中写"调用 tdx_screener / data_north_holding / mx_stocks_screener 等 MCP 工具"，或假设任何金融连接器可用。所有数据一律：
> ```bash
> export KEDOU_TOKEN='kedou_xxx'          # 从 ~/.workbuddy/mcp.json 的 Authorization 复制
> mcp_call institution get_quote '{"code":"600519"}'          # 实时行情（腾讯 qt.gtimg.cn：现价/涨跌/PE/PB/市值）
> mcp_call institution get_valuation '{"code":"600519"}'      # 估值（腾讯实时 PE/PB/市值）
> mcp_call institution get_north_holding '{"code":"600519"}'   # 北向持股
> mcp_call institution get_fund_flow '{"code":"600519","days":10}'   # 主力资金流（东财 push2delay：当日主力净流入+实时价）
> mcp_call institution get_lhb '{"code":"600519","limit":5}'
> mcp_call institution get_report '{"code":"600519"}'
> mcp_call institution get_rating '{"code":"600519"}'
> mcp_call institution get_chip '{"code":"600519"}'            # 可能 ok:false（降级）
> mcp_call institution get_finance_yoy '{"code":"600519"}'     # 可能 ok:false（降级）
> mcp_call finnews get_sector_library '{}'                     # 候选发现
> mcp_call finnews get_market_pulse '{}'
> ```
> **实时数据源**：行情/估值/主力资金流直连公开实时接口——腾讯行情 `qt.gtimg.cn`（实时价/涨跌幅/PE/PB/市值）+ 东财 `push2delay`（当日主力净流入）；北向/龙虎榜/评级/研报走东财 datacenter/reportapi。工具返回 `ok:false` 的维度，如实标注"数据暂不可用/置信度低"，禁止臆造。

## 在 web_system / MCP 环境的数据接入映射

本框架在 web_system 体系中落地时，各维度按以下优先级取数（详见 `references/data_lookup.md`）：

| 维度 | 优先数据源（web_system 环境） | 调用方式 |
|---|---|---|
| 候选发现 / 板块热度 / 个股资讯 / 市场情绪 | kedouai MCP `finnews`（`get_sector_library` / `get_sector_hot` / `get_stock_news` / `get_market_pulse`） | `//kedou-mcp-curl` → `mcp_call finnews ...` |
| 北向资金 / 静态仓位（代理） | kedouai MCP `institution`（`get_north_holding`：北向机构数 / 总持股市值 / Top3 机构）✅自托管 | `//kedou-mcp-curl` → `mcp_call institution get_north_holding '<code>'` |
| 资金流向 / 主力行为 | kedouai MCP `institution`（`get_fund_flow`：东财 `push2delay` 直连，当日主力净流入 / 近5日合计 / 实时价）✅自托管 | `//kedou-mcp-curl` → `mcp_call institution get_fund_flow '<code>'` |
| 龙虎榜 / 机构席位 | kedouai MCP `institution`（`get_lhb`：上榜买卖额 / 机构说明）✅自托管 | `//kedou-mcp-curl` → `mcp_call institution get_lhb '<code>'` |
| 实时行情 / 成本与估值 | kedouai MCP `institution`（`get_quote` 腾讯 `qt.gtimg.cn` 实时：现价/涨跌/PE/PB/市值/量比；`get_valuation` 腾讯实时 PE/PB/市值）✅自托管 | `//kedou-mcp-curl` → `mcp_call institution get_quote '<code>'` / `get_valuation '<code>'` |
| 筹码分布 / 成本结构 | kedouai MCP `institution`（`get_chip`；东财报表当前下架时返回 ok:false，标注"建议人工核对成本区"）⚠️降级 | `//kedou-mcp-curl` → `mcp_call institution get_chip '<code>'` |
| 业绩同比 / 排雷 | kedouai MCP `institution`（`get_finance_yoy`；东财 F10 报表已下架时返回 ok:false，用 get_valuation + get_rating 作代理）⚠️降级 | `//kedou-mcp-curl` → `mcp_call institution get_finance_yoy '<code>'` |
| 研报 / 评级催化 | kedouai MCP `institution`（`get_report` 研报列表 / `get_rating` 机构评级与 EPS 预测）✅自托管 | `//kedou-mcp-curl` → `mcp_call institution get_report '<code>'` / `get_rating '<code>'` |
| 增强源（可选，需授权，自动化默认不挂） | 腾讯自选股 `westock-mcp`、`tdx-connector`、`mx-ds-mcp` | 个人/项目授权后调用，覆盖更细的机构持股比例（如纯机构持股%） |

> **主数据源说明**：四维硬数据已通过 kedouai **自托管 `institution` 模块**（东方财富公开接口，content-hub :6007 实现）提供，**免任何 WorkBuddy 连接器授权**，`//kedou-mcp-curl` 即可调用——这是「未来一周关注公司」自动化的硬数据主源（2026-08-26 起生效）。其中 `get_chip`（筹码）与 `get_finance_yoy`（业绩同比）因东财对应报表接口下架而**返回 ok:false 降级**，须如实标注并改用估值/评级作代理，禁止臆造。若某维度确无数据，须如实标注缺失、降低结论强度。westock/tdx/mx-ds 仅为可选的增强授权源，不挂也不影响框架运行。

## 报告输出规范

所有分析/扫描报告统一采用**决策面板三档**格式：档1值得跟 / 档2观察等待 / 档3回避，每只票只给「结论 + 动作 + 触发价」。完整模板与实盘示例见 `references/framework_v2.md` 第六章。

## 风险边界

- 本框架只解决**资金面和情绪面**问题，无法应对基本面突变
- 基本面不达标时机构会"逻辑证伪"集体抢跑，四维验证失效
- 北向数据仅覆盖沪深港通标的，小盘股/次新股不适用第四维
- 适用于中线（1-6个月），不适合短线打板和长线价值投资
- **数据缺失时禁止编造**：任何维度数据未接入，须在报告中透明标注，宁可降低置信度也不臆造机构行为结论

## 参考文档

- `references/framework_v2.md` — 完整框架文档（含详细操作标准、阈值表格、决策矩阵、报告模板）
- `references/data_lookup.md` — 实操数据获取速查表（东方财富/同花顺路径 + 连接器能力）
