import { AgentDefinition } from '../interfaces/agent.interface';

/**
 * 变变专属 Agent。
 * 骨架占位：定义待方案确认后填充
 */
export const bianbianAgent: AgentDefinition = {
  id: 'bianbian',
  name: '变变创作助手',
  systemPrompt: '', // TODO
  model: 'hy3',
  tools: ['image-gen'],
  maxSteps: 6,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
