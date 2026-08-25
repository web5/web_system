#!/usr/bin/env ts-node
import 'reflect-metadata';
import { buildStandaloneHarness } from './harness-factory';

interface CliOptions {
  agent: string;
  message: string;
  conversationId?: string;
  list: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { agent: 'study-assistant', message: '', list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent') opts.agent = argv[++i] ?? opts.agent;
    else if (a === '--message' || a === '-m') opts.message = argv[++i] ?? '';
    else if (a === '--conversation-id' || a === '-c') opts.conversationId = argv[++i];
    else if (a === '--list' || a === '-l') opts.list = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`
科豆 AI Agent CLI —— shell 测试验证工具

用法:
  npm run agent:cli -- --agent <id> --message "<问题>" [--conversation-id <id>]
  npm run agent:cli -- --list

选项:
  -a, --agent <id>            Agent 定义 id（默认 study-assistant）
  -m, --message "<text>"     发送给 Agent 的用户消息
  -c, --conversation-id <id>  续聊的会话 id（留空则新建）
  -l, --list                  列出所有可用 Agent
  -h, --help                  显示帮助
`);
}

function colorize(text: string, color: string): string {
  const codes: Record<string, string> = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
  };
  return `${codes[color] ?? ''}${text}${codes.reset}`;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const harness = buildStandaloneHarness();

  if (opts.list) {
    console.log(colorize('可用 Agent:', 'bold'));
    for (const agent of harness.agentRegistry.list()) {
      console.log(`  ${colorize(agent.id, 'cyan')}  ${agent.name}  [tools: ${agent.tools.join(', ')}]`);
    }
    return;
  }

  if (!opts.message.trim()) {
    console.error(colorize('错误：请提供 --message 参数', 'red'));
    printHelp();
    process.exit(1);
  }

  // 校验 agent 存在
  try {
    harness.agentRegistry.get(opts.agent);
  } catch {
    console.error(colorize(`错误：未找到 Agent "${opts.agent}"，用 --list 查看可用项`, 'red'));
    process.exit(1);
  }

  console.log(colorize(`\n[用户] ${opts.message}`, 'green'));
  if (opts.conversationId) {
    console.log(colorize(`(续聊会话: ${opts.conversationId})`, 'gray'));
  }
  console.log(colorize('─'.repeat(60), 'gray'));

  const runId = 'cli';
  const userId = 'cli-user';
  let conversationId = opts.conversationId;
  let finalContent = '';

  for await (const event of harness.engine.run(
    {
      agentId: opts.agent,
      userInput: opts.message,
      conversationId: opts.conversationId,
    },
    userId,
    runId,
  )) {
    switch (event.type) {
      case 'tool_call':
        console.log(colorize(`\n🔧 调用工具: ${event.name}`, 'yellow'));
        console.log(colorize(`   参数: ${JSON.stringify(event.args)}`, 'gray'));
        break;
      case 'tool_result':
        console.log(colorize(`   结果: ${String(event.content).slice(0, 300)}`, 'gray'));
        break;
      case 'final':
        finalContent = event.content ?? '';
        conversationId = event.conversationId ?? conversationId;
        break;
      case 'error':
        console.log(colorize(`\n❌ 错误: ${event.content}`, 'red'));
        break;
      default:
        break;
    }
  }

  console.log(colorize('\n─'.repeat(60), 'gray'));
  console.log(colorize(`[Agent] ${finalContent}`, 'cyan'));
  if (conversationId) {
    console.log(colorize(`\n会话 ID: ${conversationId}（用 --conversation-id 续聊）`, 'bold'));
  }
}

main().catch((err) => {
  console.error(colorize(`CLI 运行失败: ${err.message}`, 'red'));
  process.exit(1);
});
