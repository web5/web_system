-- 音乐推荐官：一次性建「渠道 + Agent 定义」
--
-- 背景：音乐能力的代码（MusicModule / present-music-card 等 3 个工具）早已就位并注册进
-- ToolRegistry，但没有任何 Agent 挂上这些工具，且 music_providers 表为空
-- （resolveProvider 返回 null → 工具直接失败），所以「来首音乐」永远出不了卡片。
-- 本脚本补齐这两块配置数据，AI 侧 30s 轮询自动生效，无需重启。
--
-- 用法：mysql -uroot -p"$DB_PASSWORD" web_system < scripts/seed-music-agent.sql
-- 幂等：可重复执行（按 code / id 做 upsert）。

-- 1. 渠道：h5 类型（PC 端开新页跳转；小程序 appId 对 h5 无意义，留 NULL）
--    isReady 已修复为「h5 有模板即 ready」，故 PC 能真跳转而非降级复制。
INSERT INTO music_providers (code, name, app_id, entry_type, search_template, icon, sort, enabled)
VALUES (
  'qqmusic_h5',
  'QQ音乐',
  NULL,
  'h5',
  'https://y.qq.com/n/ryqq/search?w={keyword}',
  NULL,
  10,
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  entry_type = VALUES(entry_type),
  search_template = VALUES(search_template),
  enabled = 1;

-- 2. Agent 定义：音乐推荐官
-- ⚠️ capabilities 必须是 NULL 而不是 '[]'：
--    AgentDefSyncService.toAgentDefinition / resolveAgentCapabilities 的规则是
--    「capabilities 非空(含空数组)则只认它，忽略 tools 字段」——
--    填 '[]' 会让 tools 被解析成空，模型收不到任何工具，
--    只能把 <tool_calls> 当文本吐出来（2026-10-09 dev 实录）。
--    需要同时用两种能力时，应把工具写成 capabilities 数组：
--    [{"type":"tool","ref":"present-music-card","enabled":true}, ...]
INSERT INTO agent_definitions (
  id, name, system_prompt, model, tools, max_steps, temperature, memory,
  version, status, enabled, published_at, updated_by, capabilities, skills,
  streaming, description, keywords
)
VALUES (
  'music',
  '音乐推荐官',
  '你是「音乐推荐官」，负责按场景、心情与口味给用户推荐歌曲，并输出可直接跳转的音乐卡片。\n\n【流程（硬性）】\n1. 先调用 list-music-providers 获取可用渠道；拿不到就调用 present-music-card 时不传 providerCode（走默认渠道），不要向用户报错。\n2. 调用 present-music-card 输出 1–3 首歌，每首给 title（歌名）、artist（歌手）、reason（一句贴合用户场景或口味的推荐理由，20 字内）。\n3. 用户明确表达喜欢/讨厌某种风格、歌手、场景时，调用 save-music-taste 记住（增量合并，跨会话生效）。\n\n【推荐原则】\n- 结合用户说的场景（深夜、跑步、通勤、学习、失恋…）与口味档案；没明说时按场景选大众熟知的中文流行曲。\n- 歌名与歌手必须真实存在，不确定就换一首确定的，绝不编造歌名。\n- 不要长篇乐评：理由一句即可，卡片之外的正文不超过 3 句。\n\n【红线】不编造不存在的歌曲；用户只是问音乐相关事实（如「周杰伦哪年出生」「这首歌谁唱的」）时正常作答即可，不必出卡片。',
  'deepseek/deepseek-v4-flash',
  '["present-music-card", "save-music-taste", "list-music-providers"]',
  4,
  0.8,
  '{"enabled": true, "keepRecent": 6, "compactionThreshold": 20}',
  1,
  'published',
  1,
  NOW(6),
  'seed-music-agent.sql',
  NULL,
  NULL,
  1,
  '按场景/心情/口味推荐 1-3 首歌，输出可跳转的音乐推荐卡片',
  '["来首音乐", "来首歌", "来点音乐", "放首歌", "放点音乐", "推荐首歌", "推荐歌曲", "推荐音乐", "听歌", "听首歌", "想听歌", "听音乐", "歌单", "来首曲子", "背景音乐", "BGM", "配乐"]'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  system_prompt = VALUES(system_prompt),
  model = VALUES(model),
  tools = VALUES(tools),
  keywords = VALUES(keywords),
  description = VALUES(description),
  enabled = 1,
  status = 'published';
