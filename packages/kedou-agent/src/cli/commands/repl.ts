import * as readline from 'readline';
import { Harness } from '../harness';

/** 选默认 Agent：优先 general-assistant，找不到则取第一个注册的 */
function pickDefaultAgent(harness: Harness): string {
  if (harness.agentRegistry.has('general-assistant')) return 'general-assistant';
  const first = harness.agentRegistry.list()[0];
  return first?.id ?? 'general-assistant';
}

/** 打印可用 Agent 列表（供启动欢迎语和 /agents 命令复用） */
function printAgentList(harness: Harness, current?: string): void {
  console.log('\n可用 Agent:');
  for (const a of harness.agentRegistry.list()) {
    const modelReady = harness.clientRegistry.get(a.model).isAvailable();
    const tag = modelReady ? '[模型就绪]' : '[模型未配置]';
    const star = a.id === current ? '> ' : '  ';
    console.log(
      `  ${star}${a.id.padEnd(18)} ${a.name}  tools: ${a.tools.join(', ')}  ${tag}`,
    );
  }
  console.log('  （在 REPL 内输入 /agents 查看，/agent <id> 切换）');
}

/** 交互式 REPL 对话 */
export async function runRepl(harness: Harness, agentId?: string): Promise<void> {
  let agent = agentId ?? pickDefaultAgent(harness);
  try {
    harness.agentRegistry.get(agent);
  } catch {
    console.error(`错误：未找到 Agent "${agent}"，使用默认 ${pickDefaultAgent(harness)}`);
    agent = pickDefaultAgent(harness);
  }

  // 欢迎语：当前 Agent + 模型状态 + 可用 Agent 列表
  const current = harness.agentRegistry.get(agent);
  const modelReady = harness.clientRegistry.get(current.model).isAvailable();
  console.log('\n你好，我是科豆 AI Agent CLI。');
  console.log(
    `当前 Agent: ${current.name} (${current.id})  模型: ${current.model}  ${
      modelReady ? '[模型就绪]' : '[模型未配置]'
    }`,
  );
  console.log('输入 /help 查看命令，/exit 退出。');
  printAgentList(harness, agent);
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let conversationId: string | undefined;

  const ask = (): void => {
    rl.question(`(${agent}) 你> `, async (input) => {
      const line = input.trim();
      if (line === '/exit' || line === '/quit') {
        rl.close();
        return;
      }
      if (line === '/help') {
        console.log('  /exit   退出');
        console.log('  /agent <id>  切换 Agent');
        console.log('  /agents      列出所有 Agent');
        console.log('  /clear  开始新会话');
        return ask();
      }
      if (line === '/agents' || line === '/agent list') {
        printAgentList(harness, agent);
        return ask();
      }
      if (line.startsWith('/agent')) {
        const parts = line.split(/\s+/);
        const target = parts[1];
        if (!target) {
          printAgentList(harness, agent);
        } else if (harness.agentRegistry.has(target)) {
          agent = target;
          conversationId = undefined;
          const a = harness.agentRegistry.get(agent);
          console.log(`已切换到 Agent: ${a.name} (${agent})  模型: ${a.model}`);
        } else {
          console.log(`未找到 Agent "${target}"，输入 /agents 查看可用列表`);
        }
        return ask();
      }
      if (line === '/clear') {
        conversationId = undefined;
        console.log('已开始新会话');
        return ask();
      }
      if (!line) return ask();

      // 对话
      let finalContent = '';
      let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
      for await (const event of harness.engine.run(
        { agentId: agent, userInput: line, conversationId },
        'cli-user',
        'cli-repl',
        (m) => confirmDangerous(rl, m),
      )) {
        if (event.type === 'tool_call') {
          console.log(`  ↳ [工具] 调用 ${event.name}(${JSON.stringify(event.args)})`);
        } else if (event.type === 'tool_result') {
          console.log(`  ↳ [工具] ${event.name}: ${String(event.content).slice(0, 300)}`);
        } else if (event.type === 'final') {
          finalContent = event.content ?? '';
          conversationId = event.conversationId ?? conversationId;
          lastUsage = event.usage;
        } else if (event.type === 'error') {
          console.error(`  [错误] ${event.content}`);
          lastUsage = lastUsage ?? event.usage;
        }
      }
      console.log(`(Agent) ${finalContent}`);
      if (lastUsage) {
        console.log(
          `[Token] 输入 ${lastUsage.promptTokens} · 输出 ${lastUsage.completionTokens} · 合计 ${lastUsage.totalTokens}`,
        );
      }
      console.log();
      return ask();
    });
  };

  ask();
}

/** REPL 内危险命令确认：弹 [y/N] */
function confirmDangerous(rl: readline.Interface, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(`${message}`, (ans) => {
      const ok = ans.trim().toLowerCase() === 'y' || ans.trim().toLowerCase() === 'yes';
      resolve(ok);
    });
  });
}
