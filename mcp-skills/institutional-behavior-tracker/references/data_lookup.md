# 实操数据获取速查表

## 手动获取路径（东方财富/同花顺）

| 所需维度 | 查找路径 | 备注 |
|---|---|---|
| 静态持仓 | F10 -> 主力持仓 -> 机构持股汇总 | 查看"占流通股比例" |
| 机构参与度 | 个股分时图 -> 资金流向 -> 选择"机构" | 需Level-2数据 |
| 机构调研 | 公告 -> 公司调研 / 投资者关系记录 | 统计近1-2个月次数 |
| 龙虎榜数据 | 菜单 -> 数据中心 -> 龙虎榜 -> 席位明细 | 重点关注"机构专用" |
| 北向持股 | F10 -> 股东研究 -> 沪深港通持股 | 查看持股比例与变动 |
| 北向净买卖 | 数据中心 -> 沪深港通 -> 个股每日净买入 | 统计连续净买/净卖天数 |
| 机构估算成本 | 筹码分布图 -> 单峰密集区 / 龙虎榜买入均价 | 寻找放量平台区域 |
| 筹码转移 | 筹码分布图 -> 对比底部和当前筹码峰变化 | 底部峰缩小+高位峰扩大=出货 |
| 散户席位 | 龙虎榜 -> 席位明细 -> 非"机构专用"席位 | 散户净买入激增=接盘信号 |

## 数据获取路径（自动化主路径：curl 直调 kedouai MCP 端点）

> ⚠️ **自动化任务里没有 WorkBuddy MCP 工具 / 金融连接器可用**（tdx/mx-ds 需授权加不了、westock 列表无），**唯一可用的取数方式是 curl 直调 kedouai 生产 MCP 端点**。所有数据调用一律通过 `//kedou-mcp-curl` 技能的 `mcp_call(module, tool, args)` 完成（curl + JSON-RPC + Mcp-Session-Id + SSE 解析，已封装），**禁止在技能/任务里写"直接调用 MCP 工具 tdx_screener / data_north_holding 等"**。

### 方式一：kedouai MCP 端点 curl 直调（✅ 自动化唯一可用，本框架主路径）
```bash
# 前置：设置 KEDOU_TOKEN（从 ~/.workbuddy/mcp.json 的 Authorization 复制，格式 kedou_xxx）
export KEDOU_TOKEN='kedou_xxx'

# 加载 //kedou-mcp-curl 后即可用 mcp_call（内部自动 initialize 拿会话 → tools/call）
mcp_call institution get_quote '{"code":"600519"}'           # 实时行情（腾讯 qt.gtimg.cn：现价/涨跌/PE/PB/市值）
mcp_call institution get_valuation '{"code":"600519"}'      # 估值 PE/PB/市值（腾讯实时）
mcp_call institution get_north_holding '{"code":"600519"}'   # 北向持股
mcp_call institution get_fund_flow '{"code":"600519","days":10}'  # 主力资金流（东财 push2delay 当日净流入+实时价）
mcp_call institution get_lhb '{"code":"600519","limit":5}'   # 龙虎榜机构席位
mcp_call institution get_report '{"code":"600519","days":180,"limit":10}'  # 研报
mcp_call institution get_rating '{"code":"600519"}'          # 机构评级/EPS预测
mcp_call institution get_chip '{"code":"600519"}'            # 筹码（东财下架→ok:false 降级）
mcp_call institution get_finance_yoy '{"code":"600519"}'     # 业绩同比（东财下架→ok:false 降级）
mcp_call finnews get_sector_library '{}'                     # 候选发现：板块库
mcp_call finnews get_market_pulse '{}'                       # 候选发现：市场情绪
```

### 方式二：WorkBuddy 金融连接器（⚠️ 仅主会话人机对话可用，自动化任务不可用，仅作补充）
> 以下连接器在**人机对话**中可作增强数据源；**自动化任务无法访问**（tdx/mx-ds 需个人/项目授权、westock 项目列表无），框架不依赖它们。

- **腾讯自选股 (westock-mcp)**：北向 `data_north_holding`、资金流 `data_fund_flow`、龙虎榜 `data_lhb`、筹码 `data_chip`、研报 `data_report`/`data_rating`、财务 `data_finance`、股东 `data_shareholder`、评分 `data_score`
- **东方财富妙想 (mx-ds-mcp)** ⚠️需授权：行情 / 多条件选股 / 研报 / 公告 / 资讯 / 北向资金
- **通达信 (tdx-connector)** ⚠️需授权：行情 / 条件选股 / 研报 / 公告 / 基本面 / 宏观
- **进门投研 (finenter)**：路演 / 研报 / 行情 / 财务 / 量化因子
- **Wind 金融数据 (wind-finance)**：股票 / 基金 / 指数 / 债券 / 宏观 / 沪深港通
- **PandaData 金融数据 (pandadata)**：A股 / 期货 / 期权 / 港美股 / 基金 / 宏观

