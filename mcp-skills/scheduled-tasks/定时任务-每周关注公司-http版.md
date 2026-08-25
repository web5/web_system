# 未来一周关注公司 · 定时任务 Prompt（引用 //web-system-institutional-behavior-tracker + //kedou-mcp-curl · 可直接复制）

> 使用方法：打开 WorkBuddy 自动化任务 → 编辑/新建「未来一周关注公司」→ 把下方代码块内容**整体复制**到「提示词」栏。
> 本版**不依赖 mcp.json / 连接器**：finnews 与 wechat_mp 数据通过 `//kedou-mcp-curl` 技能的 `mcp_call` 函数用 curl 直调生产 MCP 端点；**分析环节必须加载 `//web-system-institutional-behavior-tracker` 技能**，对候选公司套用"机构行为全周期追踪框架"（双通道选股 + 四维验证 + 决策面板三档）。

```text
推荐未来一周值得关注的公司，并必须用"机构行为全周期追踪框架"对候选公司做机构行为分析。
不一定是新的公司——如果前面推荐过的公司仍然值得关注，继续推荐即可；如果不值得关注了，给出放弃理由，再推荐新的公司。

先加载技能：
- //kedou-mcp-curl ：提供 mcp_call(module, tool, args)，用 curl 直接调用 kedouai 生产 MCP 端点（finnews / institution / wechat_mp / paper），无需 mcp.json、无需任何 WorkBuddy 连接器授权。
- //web-system-institutional-behavior-tracker ：机构行为全周期追踪框架（双通道选股 + 四维验证 + 决策面板三档）。本任务的"分析"环节必须用它，不得只用新闻面拍脑袋下结论。

若技能内 KEDOU_TOKEN 未填真实值，先在沙箱执行：export KEDOU_TOKEN='kedou_你的真实Token'（从 ~/.workbuddy/mcp.json 的 Authorization 复制）

内容由你（AI）基于接口返回的数据生成，接口只负责提供数据。

一、候选发现（kedou-mcp-curl · finnews）
1. 用 mcp_call 调用 finnews 模块工具：
   mcp_call finnews get_sector_library '{}'      # 先取真实板块名
   mcp_call finnews get_sector_hot '{"sector":"<get_sector_library返回的真实板块名>"}'
   mcp_call finnews get_stock_news '{"symbol":"<候选代码>"}'
   mcp_call finnews get_market_pulse '{}'
2. 板块名必须来自 get_sector_library 返回的真实板块，不得自造。
3. 基于板块热度上升 + 个股实质利好资讯，初步筛选 5-8 家候选公司，注明每家的候选来源（板块热度/个股资讯/市场情绪）。
4. 候选池确定性锁定：本批候选名单一经产出，全程以此为准，分析过程不得追加/替换/删除。开头注明「候选池来源：finnews + 板块热度&个股资讯 + N家 + 扫描时间」。

二、机构行为分析（//web-system-institutional-behavior-tracker）—— 本任务核心
对每家候选公司严格套用该框架，不得省略步骤：
- 第〇步强制双通道并行：通道A（正向四维验证）+ 通道B（反向雷达回调强势票），缺一即分析作废。
- 5分钟排雷：业绩（用 mcp_call institution get_valuation 取 PE_TTM 判断估值、get_rating 取 EPS 预测趋势；营收/净利同比 get_finance_yoy 若返回 ok:false 则用估值+评级作代理）、消息面（近1月重大利空？用 mcp_call finnews get_stock_news）。基本面严重不达标直接放弃。
- 四维验证数据来源（kedouai 自托管 `institution` 模块，免连接器授权，直接 mcp_call 调用）：
  · 静态仓位（机构持了多少）：mcp_call institution get_north_holding '<code>'（北向持股作代理，含机构数/总市值/Top3）
  · 动态行为（机构正在做什么）：mcp_call institution get_fund_flow '<code>'（主力净流入趋势）、mcp_call institution get_lhb '<code>'（龙虎榜机构席位）
  · 成本与估值：mcp_call institution get_valuation '<code>'（PE/PB/总市值）、mcp_call institution get_chip '<code>'（筹码；若 ok:false 注明"东财筹码接口暂不可用，建议人工核对成本区"）
  · 研报/评级催化：mcp_call institution get_report '<code>'、mcp_call institution get_rating '<code>'
  · 若某工具返回 ok:false：必须如实标注「该维度数据暂不可用，置信度低，仅作催化面参考」，禁止用新闻面替代硬数据给出"建仓/S级"结论。
- 输出决策面板三档：档1值得跟（必带触发价+失效价）/ 档2观察等待（写明"等什么"）/ 档3回避（写明"为什么"）。每只票只给结论+动作+触发价。

三、生成关注公司清单（由你 AI 汇总）
最终输出 3-5 家：公司名称+代码、推荐理由（基于数据）、关注要点（板块/事件/资金面）、机构行为评级（S/A/C/观察）、触发价与失效价。
检查历史推荐：若之前推荐的公司仍值得关注（数据支撑），继续推荐；否则说明放弃理由再推新公司。

四、创建公众号草稿（kedou-mcp-curl · wechat_mp，只建草稿不发布）
1. 将清单转 HTML（body/p/h3/strong）：
   - 首段必须嵌入公网封面图：<img src="https://dummyimage.com/800x400/FF8C42/fff.png&text=Weekly+Watch" />
2. 文章名称固定为：大橙子社区·每周关注公司
3. 用 mcp_call 调用 wechat_mp 的 create_wechat_draft：
   mcp_call wechat_mp create_wechat_draft '{"title":"大橙子社区·每周关注公司","html":"<步骤1的HTML>"}'
4. 只创建草稿，禁止调用 publish_to_wechat 发布（公众号尚未开通发布权限，发布待认证升级后另行放开）。

五、汇报
推荐公司清单 + 机构行为评级（S/A/C/观察）+ 放弃理由 + 草稿 media_id（不汇报 publish_id）。
如实汇报数据缺失环节（如仅 finnews、未接 tdx/mx-ds）与任何失败环节，不得编造或谎称成功。

降级兜底：
- mcp_call 失败（网络/超时）重试 1 次；仍失败如实汇报失败环节。
- 若板块/个股接口无数据（如资讯未入库），如实汇报数据不足，不编造推荐。
- 任一步失败必须如实汇报失败环节与原因。

约束：
- 推荐与评级必须基于工具实际返回的数据，不得编造公司/理由/机构行为结论。
- 板块名必须先取真实板块库，不得自造板块名。
- 机构行为分析必须走双通道 + 四维验证 + 决策面板三档，禁止裸脑拍板。
- 数据缺失时透明标注置信度，宁可降低结论强度也不臆造。
- 日期统一用当天日期。
```

---

## 附：定时任务配置建议

| 配置项 | 建议值 |
|--------|--------|
| 任务名称 | 未来一周关注公司 |
| 提示词 | 上方代码块内容 |
| 工作空间 | 云端项目「个人开发工作台」（或本地 /Users/geekwen/workspace/web_system） |
| 调度 | 每周一 09:00（FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0），给出未来一周关注清单 |
| 勾选技能 | **kedou-mcp-curl**（必须，提供 mcp_call）+ **web-system-institutional-behavior-tracker**（必须，提供分析框架） |
| 建议附加连接器 | **无需附加任何连接器**：四维硬数据由 kedouai 自托管 `institution` 模块提供（免授权）；westock/tdx/mx-ds 仅作可选增强源 |
| 勾选连接器（原版） | 无需勾选 finnews / wechat_mp 连接器（已由 kedou-mcp-curl 技能 curl 完成） |

## MCP 调用方式（由 kedou-mcp-curl 技能统一提供）

本任务的 finnews / wechat_mp 调用全部通过 `kedou-mcp-curl` 技能的 `mcp_call` 函数完成：curl 实现、`Mcp-Session-Id` 会话头处理、SSE 响应解析都已在技能内封装，无需在此重复。需自定义时直接编辑技能或调用 `mcp_call(module, tool, args)`。

## 关键认知

- **分析由定时任务里的 AI 完成，并强制套用机构行为框架**：候选公司先用 finnews 发现，再经 `web-system-institutional-behavior-tracker` 的「双通道 + 四维验证 + 决策面板三档」分析，输出带触发价/失效价的行动结论。
- **候选池确定性锁定**：候选名单来自 finnews 真实板块热度+个股资讯，分析过程不得漂移到其他票。
- **数据完整性原则**：完整四维验证需要机构持仓/北向/资金流/龙虎榜硬数据。若任务只挂 kedou-mcp-curl（finnews 资讯面），必须如实标注缺失维度、降低置信度，不得用新闻面替代机构行为硬数据给出"建仓"级结论。建议额外附加 `tdx-connector` + `mx-ds-mcp` 连接器以产出完整报告。
- **板块名必须先用 get_sector_library 取真实值**，不得自造。
- **只建草稿不发布**：公众号尚未开通「发布能力」接口权限（微信 48001），所有任务只创建草稿，等认证升级后再放开发布。
- 本版彻底移除 SSH 依赖与 mcp.json 依赖，沙箱只要有 curl + python3 + 公网即可跑通。
