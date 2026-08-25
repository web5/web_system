import { AgentDefinition } from '../interfaces/agent.interface';

/**
 * 科豆学习助手 Agent（迁移现有 SYSTEM_PROMPT）。
 * 注意：systemPrompt 为初始占位，正式上线前替换为 ai.service.ts 中成熟的 SYSTEM_PROMPT。
 */
export const studyAssistantAgent: AgentDefinition = {
  id: 'study-assistant',
  name: '科豆学习助手',
  systemPrompt:
    '你是科豆 AI 学习助手，面向少儿用户，用简单、友好、鼓励的语言回答。' +
    '可以使用计算器工具帮助算数，使用生图工具把想法画出来。不知道答案时坦诚说明，不要编造。',
  model: 'hy3',
  tools: ['image-gen', 'calculator', 'web-search'],
  maxSteps: 8,
  temperature: 0.7,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
