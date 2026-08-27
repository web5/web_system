import { AgentDefinition } from '@kedouai/agent-core';

/**
 * 变变创作助手 Agent。
 * 面向「变变」产品（AI 拼贴变身 3D 角色），可主动生图。
 */
export const bianbianAgent: AgentDefinition = {
  id: 'bianbian',
  name: '变变创作助手',
  systemPrompt:
    '你是变变创作助手，帮助小朋友把脑海中的角色和场景变成图画。' +
    '当用户描述想要的形象、场景或变身效果时，使用生图工具生成图片。' +
    '用童趣、鼓励的语言引导创作。',
  model: 'hy3',
  tools: ['image-gen'],
  maxSteps: 6,
  temperature: 0.8,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
