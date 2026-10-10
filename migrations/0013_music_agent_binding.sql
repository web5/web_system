-- ⚠️ DEPRECATED（2026-10-10）—— 请勿执行，保留仅供审计追溯。
--
-- 废弃原因：
--   1. 设计前提已被取代。本迁移写于「音乐能力没有承载体」的阶段，靠给三个通用 agent
--      挂工具兜底；现在已有专职音乐 agent `id='music'`（published，17 个音乐关键词命中
--      路由，tools = list-music-providers / present-music-card / save-music-taste，
--      system_prompt 已含音乐推荐段）。再给 general 挂一套 = 双通道：会话被锁定在
--      general 且未达切换阈值（rule <0.88 / llm <0.75）时会走 general 出卡，
--      偏好写入（save-music-taste）也可能重复。
--   2. 影响面已萎缩且不对称。三个目标 id 里 `general-assistant` / `emotion` 在 dev/prod
--      均不存在，实际只有 general 一行会变；而它 capabilities 已是 [web-search]，
--      追加后 general 的 prompt 与函数表无谓膨胀（它是 keywords 为空的兜底 agent，
--      误调用概率上升）。
--   3. system_prompt 追加不可逆，本文件未提供回滚段。
--
-- ⚠️ 执行记录陷阱：`schema_migrations` 里本文件被记为 2026-09-23 16:39:26 已执行，
--    但那是**空跑** —— 目标行 `general` 的 created_at 是 2026-09-28（晚 5 天），
--    UPDATE 命中 0 行。dev/prod 两端一致，均**未生效**。
--    → 不要把 schema_migrations 当「已生效」证据，它只记「跑过」。
--
-- 如确需让通用 agent 具备音乐能力（当前不建议）：必须先在 dev 执行并验证，
-- 再同步到 prod，且自备回滚 SQL 备份 general.system_prompt 与 capabilities。
--
-- ---------------------------------------------------------------------------
-- 以下为历史原文，未作修改：
--
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
  '5. 渠道不可用时降级为文字推荐，不要伪造按钮。\n',
  '6. 严禁输出歌词原文或大段歌词（版权风险），只写歌名、歌手和你自己的推荐理由。'
)
WHERE id IN ('general', 'general-assistant', 'emotion')
  AND COALESCE(system_prompt, '') NOT LIKE '%音乐推荐%';
