import { AgentDefinition } from '../interfaces/agent.interface';

/**
 * 科豆学习助手 Agent（迁移现有 SYSTEM_PROMPT）。
 * 骨架占位：prompt 与配置待方案确认后填充
 */
export const studyAssistantAgent: AgentDefinition = {
  id: 'study-assistant',
  name: '科豆学习助手',
  systemPrompt: '', // TODO: 从现有 ai.service.ts 的 SYSTEM_PROMPT 搬入
  model: 'hy3',
  tools: ['image-gen', 'calculator'],
  maxSteps: 8,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
