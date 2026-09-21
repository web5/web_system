> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

# 歌曲推荐卡片（一期）需求 spec

> 目标端：微信小程序 `apps/kedou-ai-minigram`（聊天页）。一期**不做站内播放**，只做「推荐 + 可配置跳转到外部音乐小程序」。

## 1 用户故事

作为小程序用户，当我在对话中表达想听歌（或聊到音乐口味）时，我希望 AI 推荐符合我口味的歌曲，并给我一个按钮直接去听；下次再聊时，它记得我喜欢什么。

## 2 需求辨证（做成 / 不算做成）

- **做成**：用户说「来首歌」「推荐点安静的音乐」→ 聊天流里出现一张歌曲卡片（歌名+歌手+理由，1–3 首）+ 一个「去 <音乐平台> 听」按钮，点击跳转到**已配置的**外部音乐小程序并定位到该歌曲；系统记住本次交互中暴露的口味，下次推荐时可见地被使用。
- **不算做成**：
  - 站内直接播放音频（一期明确不做，原因见 design §2）；
  - 输出一段纯文本「你可以去 QQ音乐搜周杰伦」（无卡片、无按钮 = 未做成）；
  - 跳转目标写死在代码里（违背「可配置」）；
  - 口味只在本会话内有效（换会话即忘 = 未做成）。
- **为什么现在做**：聊天只能给文本，听歌是高频意图且体验断层明显；不做则每次都要用户自己切 App 搜。
- **不做的代价**：用户把「听歌」当成 AI 能力缺失的证据，削弱留存。

## 3 验收标准（EARS）

1. When 用户表达听歌意图（"来首歌" / "推荐点安静的" / "放周杰伦"），系统应在回复中产出**一张歌曲卡片**，包含 1–3 首歌曲（歌名、歌手、一句推荐理由）。
2. When 卡片渲染完成，系统应展示「去 <provider 名称> 听」按钮，按钮文案与跳转目标来自**已启用的 provider 配置**，而非硬编码。
3. When 用户点击该按钮，系统应跳转到对应音乐小程序并定位到该歌曲（传 keyword/歌曲定位参数）。
4. When 用户在对话中暴露口味偏好（明确说"我喜欢 jazz" 或 明确否定"别推摇滚"），系统应将该偏好**持久化到用户级档案**。
5. When 新的会话开始且该用户存在口味档案，系统应在组装 prompt 时注入口味档案，且其推荐与档案**一致**。
6. While provider 配置 `enabled=false`，when 产出卡片，系统应**不使用**该 provider（不出现在卡片按钮中）。
7. While 用户未授权/未登录，when 产出卡片，系统应仍产出卡片但口味记忆功能不可用且不报错。
8. When 历史会话被重新打开，系统应按原类型还原卡片消息（而不是退化成纯文本）。
9. When 用户进入「我的 → 音乐口味」，系统应展示已记住的偏好（喜欢 / 不想听），并支持删除单个标签、手动补充、清空全部（清空需二次确认并写明后果）。
10. While 尚无口味记录，when 用户进入口味页，系统应展示空态并给出唯一恢复入口（去对话里告诉 AI）。
11. When 用户在对话中点「不感兴趣」，系统应把该特征写入「不想听」并在口味页可见。

## 4 验证判据表 V1…V8

| 编号 | 判据（做成 = 一句话可验证） | 验证手段 | PASS 条件 | 不通过如何处理 |
|---|---|---|---|---|
| V1 | `music_providers` 表 + seed 存在，Agent 能拿到渠道 | `SELECT code,app_id,entry_type,enabled FROM music_providers`；`curl -N :6010/agent/run` 发「来点歌」观察 `tool_call` | SQL 至少 1 行 enabled=1；SSE 里出现 `tool_call: list-music-providers` 且结果含该渠道（实现为 ai-agent 本地工具，非 MCP） | 告知用户，不静默降级 |
| V2 | 听歌意图会产出 SSE `card` 事件（kind=music，1–3 首） | `curl -N -X POST :6010/agent/run`（带 JWT）发「来首安静的歌」，grep 输出 | SSE 流中出现 `{"type":"card"...}` 且 payload.songs 长度 1–3 | 同上 |
| V3 | 口味能持久化到用户级表 | 发「我喜欢周杰伦的慢歌，别推摇滚」→ `SELECT data FROM user_taste_profiles WHERE user_id='<uid>' AND namespace='music'` | data 含 artists/likes 与 dislikes 两组，跨会话（新 conversationId）仍在 | 同上 |
| V4 | 新会话会注入口味档案 | 换 conversationId 再发「来首歌」→ 查 ai-agent 日志 | 日志出现 `注入用户口味档案`；回复歌曲与档案一致（周杰伦/慢歌，无摇滚） | 同上 |
| V5 | provider 关闭即下架 | `UPDATE music_providers SET enabled=0 WHERE code='qqmusic'`（等 30s 同步）→ 重跑 V2 | 卡片 provider 不再是 qqmusic（取下一个已启用 provider） | 同上 |
| V6 | 小程序侧类型与卡片/口味页注册无回归 | `npx tsc --noEmit --skipLibCheck --moduleResolution node --target es2019 --lib es2019 <新增文件>`（`@types/weixin-miniprogram` 未装，故忽略其全局报错）；`grep -n "music-card" pages/chat/index/index.json`；`grep -n "pages/mine/taste/index" app.json` | 除 wx/Page/Component 全局缺失外 0 error；组件与页面均已注册 | 同上 |
| V7 | 卡片可渲染且按钮可跳转（人验） | 开发者工具/真机跑聊天页，发「来首歌」，点按钮；留截图 | 卡片气泡出现（歌名/歌手/理由/按钮），点击成功跳转目标小程序并定位歌曲 | 同上 |
| V8 | 历史会话卡片可还原 | 退出会话重进，观察历史消息 | 卡片按原样还原，不是纯文本 | 同上 |
| V9 | 口味接口可读写 | `curl :6010/user-taste/music?namespace=music`（带 JWT）+ `PUT` 改一个标签再 `GET` | GET 返回该用户 profile；PUT 后 GET 一致 | 同上 |
| V10 | 口味页可查看/增删/清空（人验） | 我的 → 音乐口味：删标签、补一个、点清空走二次确认；留截图 | 三操作均生效且二次确认写明后果；清空后显示空态 | 同上 |

> V7 为人工验证项（小程序 UI 无法命令化断言），PASS 条件已写明，不接受「看着对」。

## 5 待确认

- [ ] 音乐小程序跳转是否需要微信后台业务配置（`navigateToMiniProgramAppIdList` 上限 10 个 + 需声明用途）？谁来配？
- [ ] 一期 provider 范围：QQ音乐 + 网易云，还是只 QQ音乐先跑通？
- [ ] 歌曲元数据来源：LLM 生成（零外部依赖，本期方案）还是后续接正规曲库 API？
- [ ] 口味是否需要在「我的」页可见/可编辑（一期只做隐式记忆 + Agent 调用，不做 UI）？
- [ ] 是否需要 admin 侧配置页（一期用 SQL seed + 内部接口，暂不做页面）？
