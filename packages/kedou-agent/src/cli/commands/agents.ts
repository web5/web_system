import { buildHarness } from '../harness';

export function runAgents(): void {
  const harness = buildHarness();
  console.log('\n可用 Agent:');
  for (const agent of harness.agentRegistry.list()) {
    const modelReady = harness.clientRegistry.get(agent.model).isAvailable();
    const tag = modelReady ? '[模型就绪]' : '[模型未配置]';
    console.log(`  ${agent.id.padEnd(18)} ${agent.name}  tools: ${agent.tools.join(', ')}  ${tag}`);
  }
  console.log('\n提示：首次对话前运行 `kedou-agent` 或 `kedou-agent config` 配置大模型。');
}
