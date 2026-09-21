-- 0013 · 音乐推荐能力绑定到 Agent（general / general-assistant / emotion）
--
-- 背景：工具已在 ai-agent 的 ToolRegistry 注册，但引擎按 agent_definitions.capabilities
--       决定「这个 agent 能看到哪些工具」；不绑定 = 模型看不到工具 = 出不了卡片。
-- 绑定范围说明：听歌意图经 LLM 路由，可能落到通用助手 / 通用问答 / 情感陪聊，
--       故这三个都挂；后续如新增专职音乐 agent，在此 SQL 追加一行 id 即可。
-- 幂等：capabilities 已含 present-music-card 或提示词已含「音乐推荐」则跳过。

UPDATE agent_definitions
SET capabilities = JSON_MERGE_PRESERVE(
  COALESCE(capabilities, JSON_ARRAY()),
  JSON_ARRAY(
    JSON_OBJECT('type', 'tool', 'ref', 'list-music-providers', 'enabled', TRUE),
    JSON_OBJECT('type', 'tool', 'ref', 'present-music-card', 'enabled', TRUE),
    JSON_OBJECT('type', 'tool', 'ref', 'save-music-taste', 'enabled', TRUE)
  )
)
WHERE id IN ('general', 'general-assistant', 'emotion')
  AND JSON_SEARCH(COALESCE(capabilities, JSON_ARRAY()), 'one', 'present-music-card') IS NULL;

-- 注意：MySQL 的 || 默认是逻辑或（除非启用 PIPES_AS_CONCAT），多段拼接一律用 CONCAT(a,b,c...)。
UPDATE agent_definitions
SET system_prompt = CONCAT(
  COALESCE(system_prompt, ''),
  '\n\n## 音乐推荐（用户想听歌 / 聊到音乐时）\n',
  '1. 先调用 list-music-providers 获取可用渠道 code，不要凭印象写平台名。\n',
  '2. 再用 present-music-card 出卡片：1–3 首，每首给歌名、歌手和一句贴合用户口味（或当前场景）的推荐理由。\n',
  '3. 用户表达偏好或否定时（如“我喜欢民谣”“别推摇滚”），调用 save-music-taste 记下来；下次推荐必须避开“不想听”。\n',
  '4. 不要承诺在本小程序内播放，也不要编造播放链接或歌曲 URL；跳转由系统给出。\n',
  '5. 渠道不可用时降级为文字推荐，不要伪造按钮。'
)
WHERE id IN ('general', 'general-assistant', 'emotion')
  AND COALESCE(system_prompt, '') NOT LIKE '%音乐推荐%';
