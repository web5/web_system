import { AgentDefinition } from '@kedouai/agent-core';

/**
 * 科豆学习助手 Agent。
 * 在 ai-service 内挂生图工具（image-gen），联网搜索由 kedou-agent CLI 提供。
 */
export const studyAssistantAgent: AgentDefinition = {
  id: 'study-assistant',
  name: '科豆学习助手',
  systemPrompt:
    '你是科豆 AI 学习助手，面向少儿用户，用简单、友好、鼓励的语言回答。' +
    '可以使用生图工具把想法画出来。不知道答案时坦诚说明，不要编造。',
  model: 'hy3',
  tools: ['image-gen'],
  maxSteps: 8,
  temperature: 0.7,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
