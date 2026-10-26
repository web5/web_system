-- 0019: 热点资讯管线 + 采集源（2026-10-26）
-- 需求：新增「热点资讯」管线，覆盖科技、娱乐、相关信息
-- 幂等：按 code 唯一键 upsert

-- ── 采集源（category='热点'，管线类型 hot-news 只采这个分类）──
INSERT INTO content_sources (code, name, type, config, category, enabled, created_at, updated_at)
VALUES
  ('rss-36kr',       '36氪',         'rss', '{"url":"https://36kr.com/feed"}',                          '热点', 1, NOW(6), NOW(6)),
  ('rss-ifanr',      '爱范儿',       'rss', '{"url":"https://www.ifanr.com/feed"}',                     '热点', 1, NOW(6), NOW(6)),
  ('rss-sspai',      '少数派',       'rss', '{"url":"https://sspai.com/feed"}',                         '热点', 1, NOW(6), NOW(6)),
  ('rss-techcrunch', 'TechCrunch',   'rss', '{"url":"https://techcrunch.com/feed/"}',                   '热点', 1, NOW(6), NOW(6)),
  ('rss-theverge',   'The Verge',    'rss', '{"url":"https://www.theverge.com/rss/index.xml"}',         '热点', 1, NOW(6), NOW(6))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  config = VALUES(config),
  category = VALUES(category),
  updated_at = NOW(6);

-- ── 管线 ──
-- cron 12:00（错开 daily_paper 09:00 与 ai_news 08:00）
-- publish_mode=draft：个人号草稿即终态
INSERT INTO content_pipelines (code, type, title_template, cron, llm_prompt, publish_targets, publish_mode, tencent_folder, enabled, created_at, updated_at)
VALUES (
  'hot_news',
  'hot-news',
  '{{datetime}} ｜ 热点资讯',
  '0 12 * * *',
  '你是「大橙子社区」的热点资讯编辑，覆盖科技、娱乐、社会等大众关注的热点话题。\n\n请阅读以下资讯的标题与内容，用中文输出结构化摘要，只输出 JSON，不要有任何其他文字。\n\n输出格式（严格遵守）：\n{\n  "摘要": "一句话中文摘要（≤50 字，说清事件本身 + 为什么值得关注）",\n  "标签": ["2-3 个关键词标签"],\n  "分类": "科技|数码|互联网|娱乐|影视|音乐|游戏|社会|财经|其他"\n}\n\n写作要求：\n1. 摘要要有「热点感」：说清事件 + 影响面/争议点/与普通人的关联\n2. 标签要帮助读者快速归类（如「iPhone17」「春节档」「AI 教育」）\n3. 分类只能从给定 10 个选项中选一个，选最匹配的\n4. 科技类关注新品发布、技术突破、行业变局；娱乐类关注影视、音乐、明星、综艺\n5. 只基于原文内容，不添加原文没有的评价或猜测\n6. 语气客观但不枯燥，可适当用「网友热议」「业内人士表示」等新闻语体',
  '["wechat_mp"]',
  'draft',
  NULL,
  1,
  NOW(6), NOW(6)
)
ON DUPLICATE KEY UPDATE
  type = VALUES(type),
  title_template = VALUES(title_template),
  cron = VALUES(cron),
  llm_prompt = VALUES(llm_prompt),
  publish_targets = VALUES(publish_targets),
  publish_mode = VALUES(publish_mode),
  updated_at = NOW(6);
