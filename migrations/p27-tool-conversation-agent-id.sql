-- @database web_system

-- p27：回填工具页会话的 agent_id（2026-09-23）。
--
-- 背景：工具页（翻译 / 合翻）会话以 source='tool' 落库，但 agent_id 原本只有意图路由
-- （IntentService，默认关闭且只服务主对话）会写 —— 工具页是**显式指定** agent 的，
-- 于是这些会话的 agent_id 恒为 NULL。列表接口加了 agentId 过滤后，左栏「翻译记录 /
-- 体检记录」一条都不显示（实测：source=tool 有 1 条，source=tool&agentId=translate 为 0）。
--
-- 代码侧已在 agent.controller 的 markSource 一并落库 agentId（新会话不再缺），
-- 本迁移只回填**历史**行：按首条 user 消息特征判断能力
--   · 含「【源语言】」 → translate（翻译工作台 prompt）
--   · 含「【合同内容】」 → contract-risk（合翻工作台 prompt）
-- 判断不出来的行保持 NULL（不当 guess，后续由新代码覆盖）。
--
-- 幂等：只更新 source='tool' AND agent_id IS NULL 的行，重复执行无副作用。

UPDATE agent_conversations
   SET agent_id = 'translate'
 WHERE source = 'tool'
   AND agent_id IS NULL
   AND JSON_UNQUOTE(JSON_EXTRACT(messages, '$[0].content')) LIKE '%【源语言】%';

UPDATE agent_conversations
   SET agent_id = 'contract-risk'
 WHERE source = 'tool'
   AND agent_id IS NULL
   AND JSON_UNQUOTE(JSON_EXTRACT(messages, '$[0].content')) LIKE '%【合同内容】%';
