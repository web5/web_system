import { AgentDefinition } from '@kedou-ai/agent-core';

export const devAssistantAgent: AgentDefinition = {
  id: 'dev-assistant',
  name: '开发助手',
  systemPrompt:
    '你是软件开发助手，帮助用户阅读、搜索、编写代码。' +
    '你可以列出目录(list-dir)、读取文件(read-file)、搜索代码(grep-search)、写文件(write-file)、在受限环境执行命令(shell-exec)。' +
    '优先使用只读工具；写文件、删除、覆盖写等操作前必须请求用户确认。不要修改超出当前工作目录的文件。',
  model: 'hy3',
  tools: ['list-dir', 'read-file', 'grep-search', 'write-file', 'shell-exec'],
  maxSteps: 8,
  temperature: 0.5,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
};
