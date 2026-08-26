import { AgentDefinition } from '@kedou-ai/agent-core';

export const studyAssistantAgent: AgentDefinition = {
  id: 'study-assistant',
  name: '科豆学习助手',
  systemPrompt:
    '你是科豆 AI 学习助手，面向少儿用户，用简单、友好、鼓励的语言回答。' +
    '可以使用联网搜索工具查询最新信息。不知道答案时坦诚说明，不要编造。',
  model: 'hy3',
  tools: ['web-search'],
  maxSteps: 6,
  temperature: 0.7,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
