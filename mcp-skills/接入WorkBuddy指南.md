# web_system 三个 MCP 正式接入 WorkBuddy（云端自动化可用）指南

> 背景：本地软链技能 + 手写 `~/.workbuddy/mcp.json` 只在当前对话生效，**云端自动化任务识别不到**。
> 要让定时任务正常加载 MCP 和技能，必须走下面两条正规路径。

---

## 一、技能上传到云端（三个 zip 包）

技能包已打好，位于 `web_system/mcp-skills/`：

| 技能包 | 内容 | 用途 |
|--------|------|------|
| `web-system-finnews.zip` | 财经资讯 6 工具调用规范 | 快讯 / 情绪 / 板块 / 个股 / 检索 |
| `web-system-paper.zip` | 论文学习工具调用规范 | arXiv AI/ML 论文速览 / 中英双语日报 |
| `web-system-wechat-mp.zip` | 公众号发布 2 工具调用规范 | 建草稿 / 一键发布 |

### 上传步骤

1. 打开 WorkBuddy → **技能中心**（左侧菜单「专家-技能-连接器」→ 技能 Tab）
2. 点击右上角 **+ / 导入技能** → 选择 **上传技能包（.zip）**
3. 依次上传上面三个 zip
4. 上传后技能出现在「我的技能」列表，名称分别为 `web-system-finnews`、`web-system-paper`、`web-system-wechat-mp`

### 验证

上传后确认技能名出现在自动化任务可选的技能列表里（创建/编辑自动化任务时，「选择模型和技能」能勾选到它们）。

---

## 二、连接器正式授权（三个 MCP 端点）

目前 `~/.workbuddy/mcp.json` 里手动写的连接器，**不会被自动化任务识别为已授权连接器**。需要改到连接器中心正式添加。

### 自定义连接器添加步骤

1. 打开 WorkBuddy → **连接器中心**（左侧菜单「连接器」）
2. 点击右上角 **自定义连接器** → 添加自定义 MCP
3. 填入以下三个配置：

**① 财经资讯（finnews）**

| 字段 | 值 |
|------|-----|
| 名称 | 橙子财经资讯 |
| 类型 | streamableHttp |
| URL | `https://kedouai.com/mcp/finnews` |
| Header | `Authorization: Bearer <你的 kedou_xxx API Key>` |
| 超时 | 60000 |

**② 论文学习（paper）**

| 字段 | 值 |
|------|-----|
| 名称 | web-system-paper |
| 类型 | streamableHttp |
| URL | `https://kedouai.com/mcp/paper` |
| Header | `Authorization: Bearer <你的 kedou_xxx API Key>` |
| 超时 | 120000 |

**③ 公众号发布（wechat_mp）**

| 字段 | 值 |
|------|-----|
| 名称 | wechat-mp-publisher |
| 类型 | streamableHttp |
| URL | `https://kedouai.com/mcp/wechat_mp` |
| Header | `Authorization: Bearer <你的 kedou_xxx API Key>` |
| 超时 | 120000 |

4. 保存后连接器卡片显示绿色圆点（已连接）

### 验证

在自动化任务创建页，这些连接器应出现在可附加的连接器列表中。

---

## 三、自动化任务引用方式（重点）

WorkBuddy 自动化任务里，**技能和连接器不是结构化字段**，正确用法是：

- 技能：在任务的 **提示词（prompt）** 里以 `//skill_name` 形式内联引用，例如：

```
//web-system-finnews
//web-system-paper
//web-system-wechat-mp

依次执行：
1. 调用 get_market_pulse 获取市场情绪
2. ...
```

- 连接器：创建任务时在「选择模型和技能」区域勾选 `橙子财经资讯`、`web-system-paper`、`wechat-mp-publisher`，或确认任务支持附加的连接器列表里能看到它们

> 注意：技能名必须先出现在自动化任务可用技能列表里（第一步验证通过），prompt 里写 `//名称` 才会生效。

---

## 四、MCP 降级兜底（MCP 不可用时走 dev 机器脚本）

两个内容链路都配了降级脚本：MCP 不通时 SSH 登录 dev 机器，直连 content-hub REST 接口完成取数 + 生成 + 建稿/发布。

| 链路 | 降级脚本 | 数据源 |
|------|---------|--------|
| 财经日报 | `web_system/scripts/mcp-fallback/wechat-fallback-publish.sh` | dev 机器 content-hub `/api/market-pulse` `/api/topics` |
| 论文日报 | `web_system/scripts/mcp-fallback/paper-fallback-publish.sh` | arXiv 官方 API（`export.arxiv.org/api/query`） |

### 降级脚本用法

```bash
# 财经日报：仅建草稿（默认，安全）
bash web_system/scripts/mcp-fallback/wechat-fallback-publish.sh

# 论文日报：仅建草稿
bash web_system/scripts/mcp-fallback/paper-fallback-publish.sh

# 加 --publish 直接发布；--dry-run 预览不执行；--title "自定义标题"
bash web_system/scripts/mcp-fallback/paper-fallback-publish.sh --publish --title "今日论文"
```

### 技能内已内置降级说明

- `web-system-finnews`：数据源降级到 dev 机器 content-hub REST 接口
- `web-system-paper`：数据源降级到 arXiv 官方 API
- `web-system-wechat-mp`：两个降级脚本最终都经它完成建稿/发布

---

## 五、现有自动化任务

| 任务 ID | 名称 | 时间 | 说明 |
|---------|------|------|------|
| `automation-1787540662927` | 每日财经日报生成公众号草稿 | 每天 08:30 | 财经日报 → 草稿箱 |
| `automation-1787554066012` | 每日论文学习·dev 链路（arXiv AI/ML） | 每天 09:00 | 论文日报 → 草稿箱 |

> 之前临时验证用的 `临时验证-财经日报生成草稿（含封面）`（automation-1787541493165）是一次性任务，已执行完毕无需处理。

---

## 参考文档

- WorkBuddy 自动化指南：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide
- WorkBuddy 连接器指南：https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector
