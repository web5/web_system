import { Harness } from '../harness';

/** 单轮非交互对话（--message） */
export async function runChat(
  harness: Harness,
  agentId: string | undefined,
  message: string,
  conversationId?: string,
): Promise<void> {
  const id = agentId ?? 'general-assistant';
  let agent;
  try {
    agent = harness.agentRegistry.get(id);
  } catch {
    console.error(`错误：未找到 Agent "${id}"，用 \`kedou-agent agents\` 查看可用项`);
    process.exit(1);
  }

  const client = harness.clientRegistry.get(agent.model);
  if (!client.isAvailable()) {
    console.error(
      `错误：Agent "${id}" 使用的模型 "${agent.model}" 尚未配置。请运行 \`kedou-agent config\` 配置。`,
    );
    process.exit(1);
  }

  console.log(`\n[用户] ${message}`);
  console.log('-'.repeat(50));

  let finalContent = '';
  let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
  for await (const event of harness.engine.run(
    { agentId: id, userInput: message, conversationId },
    'cli-user',
    'cli-run',
    async () => false, // 非交互：危险命令默认拒绝
  )) {
    if (event.type === 'tool_call') {
      console.log(`  [工具] 调用 ${event.name}`);
    } else if (event.type === 'tool_result') {
      console.log(`  [工具] ${event.name}: ${String(event.content).slice(0, 200)}`);
    } else if (event.type === 'final') {
      finalContent = event.content ?? '';
      lastUsage = event.usage;
    } else if (event.type === 'error') {
      console.error(`  [错误] ${event.content}`);
      lastUsage = lastUsage ?? event.usage;
    }
  }

  console.log('-'.repeat(50));
  console.log(`[Agent] ${finalContent}`);
  if (lastUsage) {
    console.log(`[Token] 输入 ${lastUsage.promptTokens} · 输出 ${lastUsage.completionTokens} · 合计 ${lastUsage.totalTokens}`);
  }
}
