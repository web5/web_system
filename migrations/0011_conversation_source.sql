-- 0011 · 会话来源标记（主对话记录只出「主对话」产生的会话）
--
-- 背景：翻译页 / 合同评估页这类**工具页**也会创建会话，但它们各有自己的历史入口，
--       混进「对话记录」列表会干扰主对话的浏览（用户反馈）。
-- 注意：不能用 agent_id 区分来源 —— 主对话被意图路由到「语言翻译官」时 agent_id 同样是
--       translate，按 agent 过滤会误杀正常的主对话会话。因此显式加 source 列。
--
-- 目标库：web_system（ai-agent 侧会话表）
-- 存量数据：默认 'chat'，即都算主对话（历史会话不受影响，不做回填）

ALTER TABLE agent_conversations
  ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'chat' COMMENT '会话来源：chat=主对话 / tool=工具页（翻译、合同）' AFTER meta;

ALTER TABLE agent_conversations
  ADD INDEX idx_agent_conversations_source (source);
