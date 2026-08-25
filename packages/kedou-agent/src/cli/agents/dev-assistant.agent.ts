import { AgentDefinition } from '@kedou/agent-core';

export const devAssistantAgent: AgentDefinition = {
  id: 'dev-assistant',
  name: '开发助手',
  systemPrompt:
    '你是软件开发助手，帮助用户阅读、搜索和理解代码。' +
    '你可以列出目录(list-dir)、读取文件(read-file)、搜索代码(grep-search)、在受限环境执行命令(shell-exec)。' +
    '优先使用只读工具；执行删除、覆盖写等危险命令前必须请求用户确认。不要修改超出当前工作目录的文件。',
  model: 'hy3',
  tools: ['list-dir', 'read-file', 'grep-search', 'shell-exec'],
  maxSteps: 8,
  temperature: 0.5,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
