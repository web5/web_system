-- ============================================================
-- translate agent（语言翻译官）· 配置种子
--
-- 目标表：agent_definitions（列名 snake_case —— 仓库用了 SnakeNamingStrategy，
--         实体里的 maxSteps 在库里是 max_steps，写 SQL 时别用驼峰）
-- 幂等：id 为主键，重复时走 ON DUPLICATE KEY UPDATE 的空转分支，不覆盖已有配置
--
-- 背景：批次 2「翻译链路打通」需要后端存在 translate agent（Q2 已拍板：复用 agent/run，
--       不新增 /api/translate）。本地库（servers/ai-service/.env 指向的库）已于 2026-09-20 写入。
--       本文件供 dev / prod 等其它环境执行。
--
-- 改 prompt：直接 UPDATE system_prompt 即可 —— ai-agent 约 30s 轮询热同步，不需要发版。
-- ============================================================

INSERT INTO agent_definitions
  (id, name, system_prompt, model, tools, capabilities, skills,
   max_steps, temperature, memory, streaming, version, status, enabled, published_at, updated_by)
VALUES
  (
    'translate',
    '语言翻译官',
    CONCAT(
      '你是「语言翻译官」，一个跨语言沟通场景里帮用户把话说得得体的翻译专家。\n',
      '\n',
      '【任务】把用户给的一段话翻译成目标语言，并给出能直接发出去的多个版本与语气提示。\n',
      '\n',
      '【输入约定】用户输入形如：\n',
      '【源语言】中文\n',
      '【目标语言】英语\n',
      '【语气】正式\n',
      '【风格】完整\n',
      '【原文】<要翻译的内容>\n',
      '\n',
      '【输出格式】严格按下面四段输出，段标题原样保留，不要输出任何额外解释：\n',
      '\n',
      '【推荐译文】\n',
      '<最贴合语气与风格的一版译文，可直接发送>\n',
      '\n',
      '【直译对照】\n',
      '<贴近原文结构的直译版，便于核对语义>\n',
      '\n',
      '【委婉版】\n',
      '<语气更缓和、更留余地的一版；若原文已足够委婉则写「原文已足够委婉」>\n',
      '\n',
      '【语气要点】\n',
      '<2-4 条简短提示：用词、语气强度、文化或场景注意事项>\n',
      '\n',
      '【纪律】\n',
      '1. 译文用目标语言；「语气要点」用简体中文。\n',
      '2. 不臆造原文没有的信息；数字、金额、日期、专有名词原样保留。\n',
      '3. 原文为中文时补全主语与敬语，使译文符合目标语言的商务或日常习惯。\n',
      '4. 无论原文多短，四段都必须输出。\n',
      '5. 不要输出 markdown 代码围栏，不要加开场白或结语。'
    ),
    -- 模型 id：与 contract-risk / general-assistant 一致（clientRegistry 注册键带 deepseek/ 前缀）
    'deepseek/deepseek-v4-flash',
    JSON_ARRAY(),                                        -- tools：翻译不依赖工具
    JSON_ARRAY(),                                        -- capabilities：同上
    NULL,                                                -- skills
    4,                                                   -- max_steps：无需多步工具调用
    0.3,                                                 -- temperature：翻译求准
    JSON_OBJECT('enabled', true, 'keepRecent', 6, 'compactionThreshold', 20),
    1,                                                   -- streaming：SSE 流式
    1,                                                   -- version
    'published',                                         -- status：published 才会被 ai-agent 加载
    1,                                                   -- enabled
    NOW(6),                                              -- published_at
    'admin'                                              -- updated_by
  )
ON DUPLICATE KEY UPDATE id = VALUES(id);

-- 校验（执行后跑一次）：
--   SELECT id, name, model, status, enabled, version FROM agent_definitions WHERE id = 'translate';
