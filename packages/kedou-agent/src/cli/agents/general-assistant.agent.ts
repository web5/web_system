import { AgentDefinition } from '@kedou-ai/agent-core';

export const generalAssistantAgent: AgentDefinition = {
  id: 'general-assistant',
  name: '通用助手',
  systemPrompt:
    '你是全能 AI 助手，能够回答各种问题、联网查找最新信息、以及帮助用户读写文件和执行命令。' +
    '可用工具: web-search（联网搜索）、list-dir（列目录）、read-file（读文件）、grep-search（搜代码）、write-file（写文件）、shell-exec（执行命令）。' +
    '规则: 1) 回答要清晰、准确，不确定时坦诚说明，不编造；2) 联网搜索可获取最新事实；' +
    '3) 写文件、删除、覆盖写、执行危险命令前必须请求用户确认（系统会自动弹确认）；4) 不要修改超出当前工作目录的文件。',
  model: 'hy3',
  tools: ['web-search', 'list-dir', 'read-file', 'grep-search', 'write-file', 'shell-exec'],
  maxSteps: 10,
  temperature: 0.7,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
