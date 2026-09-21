-- 0010 · 会话意图路由（主对话多 Agent 路由的硬前提）
--
-- 背景：主对话接入多 Agent 意图路由，需要把「本会话当前由哪个 agent 负责」持久化，
--       否则每一轮都会重新分类（人格割裂 + 追问被切走 + 分类成本翻倍）。
-- 目标库：web_system（ai-agent 侧会话表 agent_conversations）
-- 适用：NODE_ENV=production（TypeORM synchronize 关闭）的环境必须手动执行。
--
-- 幂等说明：MySQL 不支持 ADD COLUMN IF NOT EXISTS，重复执行会报 duplicate column，
--           这是预期行为（说明已执行过），可安全忽略。

ALTER TABLE agent_conversations
  ADD COLUMN agent_id VARCHAR(64) NULL COMMENT '当前会话锁定的 agentId（意图路由）' AFTER title,
  ADD COLUMN intent_history JSON NULL COMMENT '意图判定流水：[{agentId,via,ts}]' AFTER agent_id;

ALTER TABLE agent_conversations
  ADD INDEX idx_agent_conversations_agent (agent_id);
