import * as readline from 'readline';
import { Harness } from '../harness';

/** 交互式 REPL 对话 */
export async function runRepl(harness: Harness, agentId?: string): Promise<void> {
  let agent = agentId ?? 'study-assistant';
  try {
    harness.agentRegistry.get(agent);
  } catch {
    console.error(`错误：未找到 Agent "${agent}"，使用默认 study-assistant`);
    agent = 'study-assistant';
  }

  console.log('\n进入对话（输入 /exit 退出，/help 帮助，/agent <id> 切换 Agent）\n');

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
        console.log('  /exit  退出\n  /agent <id>  切换 Agent\n  /clear  开始新会话');
        return ask();
      }
      if (line.startsWith('/agent')) {
        const parts = line.split(/\s+/);
        const target = parts[1];
        if (target && harness.agentRegistry.has(target)) {
          agent = target;
          conversationId = undefined;
          console.log(`已切换到 Agent: ${agent}`);
        } else {
          console.log(`未找到 Agent "${target}"`);
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
        } else if (event.type === 'error') {
          console.error(`  [错误] ${event.content}`);
        }
      }
      console.log(`(Agent) ${finalContent}\n`);
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
