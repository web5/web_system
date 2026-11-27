import { createApp } from 'vue';
import { mountAgentPanel } from '@/microfrontend/bootstrap';
import '@/styles/global.css';
import '@/styles/markdown.css';

const container = document.getElementById('app');
if (!container) {
  throw new Error('#app container not found');
}

const handle = mountAgentPanel(container, {
  endpoint: import.meta.env.VITE_AGUI_ENDPOINT || '/agui',
  mcpKey: import.meta.env.VITE_MCP_KEY || '',
  // 打开页面即开始真 SSE 流式（按钮仍可重跑一轮，用于验证 widget 状态不丢失 / 无泄漏）
  autoConnect: true,
});

// 暴露到 window 便于调试 / 手动验证「卸载无泄漏」
(window as unknown as { __agentPanel?: ReturnType<typeof mountAgentPanel> }).__agentPanel = handle;
