> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on

# 歌曲推荐卡片（一期）实施清单

> 每项绑定 V#，交付时按同一编号逐条给证据。

## 前置

- [ ] 0. 真机确认 QQ音乐小程序 appid + 搜索定位 path（**唯一未决阻塞**）→ 填 `music_providers.app_id`　（判据：V1、V7）
  - 现状：`app_id='PENDING_QQMUSIC'` 占位，卡片降级为「复制歌名」，功能不报错

## 数据层

- [x] 1. 建 `music_providers` 实体 + 表 + seed（qqmusic，enabled=1）　（判据：V1）
- [x] 2. 建 `user_taste_profiles` 实体 + 表（唯一索引 user_id+namespace）　（判据：V3）
  - 迁移：`migrations/0012_music_recommend.sql`（pm2 以 production 运行，synchronize 关闭，DDL 走迁移）

## 后端能力

- [x] 3. 工具 `list-music-providers`（读 enabled provider，按 sort）　（判据：V1、V5）
- [x] 4. 工具 `present-music-card` + SSE `card` 事件（runtime.interface 加类型 / controller 补发 / 落库走 tool_result）　（判据：V2、V6）
- [x] 5. 工具 `save-music-taste` + 口味注入链路（memory-port 扩 `loadProfile?` / DbConversationMemory 实现 / agent-engine 注入）　（判据：V3、V4）
- [x] 6. agent 定义绑定：`general` / `general-assistant` / `emotion` 三个 agent 的 capabilities + systemPrompt　（判据：V2、V4）
  - 迁移：`migrations/0013_music_agent_binding.sql`（幂等）

## 前端

- [x] 7. `components/music-card` 组件 + 页面 json 注册 + `ChatMsg` 加 `musicCard`（**不复用已被译文卡占用的 `card` 字段**）+ wxml 分支 + 历史还原（解析 tool 消息里的卡片 JSON）　（判据：V6、V7、V8）
- [x] 8. 跳转 `wx.navigateToMiniProgram` + 失败降级「复制歌名」（**不写 app.json 白名单**：官方全局配置已无该字段）　（判据：V6、V7）
- [x] 9. 口味读写接口 `GET/PUT/DELETE /user-taste/music`（`DELETE /tag` 删单个标签）　（判据：V9）
- [x] 10. `pages/mine/taste/`（方案 B 扁平列表 / 增删 / 补充 / 清空二次确认 / 空态）+ 我的页「AI 记忆」入口行　（判据：V10）

## 验证

- [ ] 11. 跑 V1–V6、V9 机器判据 + V7/V8/V10 人验，逐条记录证据　（判据：V1–V10）
  - 已完成：V1 / V2 / V3 / V4 / V6 / V9（见交付记录）
  - 待真机：V5（provider 关闭下架）/ V7（卡片渲染 + 跳转）/ V8（历史还原）/ V10（口味页人验）

## 依赖顺序

```
0 → 1,2 → 3,5 → 4 → 6 → 7 → 8 → 11
                 9 → 10 → 11
```

## 原型稿

- 状态：**需要（用户已确认）** → `apps/kedou-ai-minigram/prototype/music-taste.html` + `specs/music-recommend/page-spec.md`
- 门禁：原型与规格已过用户确认并**单独 commit** → `e426a1f`；落地 commit `0745b29` 的 message 已带 `Proto: e426a1f`
