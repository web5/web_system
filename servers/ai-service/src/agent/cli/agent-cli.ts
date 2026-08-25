#!/usr/bin/env ts-node
import 'reflect-metadata';
import { buildStandaloneHarness } from './harness-factory';
import { AgentDefinition } from '../interfaces/agent.interface';
import { ensureConfig, applyConfigToEnv } from './config-store';

const COLORS: Record<string, string> = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

function c(text: string, color: string): string {
  return `${COLORS[color] ?? ''}${text}${COLORS.reset}`;
}

interface CliOptions {
  agent: string;
  message: string;
  conversationId?: string;
  list: boolean;
  models: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { agent: 'study-assistant', message: '', list: false, models: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agent') opts.agent = argv[++i] ?? opts.agent;
    else if (a === '--message' || a === '-m') opts.message = argv[++i] ?? '';
    else if (a === '--conversation-id' || a === '-c') opts.conversationId = argv[++i];
    else if (a === '--list' || a === '-l') opts.list = true;
    else if (a === '--models') opts.models = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`
${c('科豆 AI Agent CLI', 'bold')} —— shell 测试验证工具

${c('用法:', 'bold')}
  npm run agent:cli -- --agent <id> --message "<问题>" [--conversation-id <id>]
  npm run agent:cli -- --list
  npm run agent:cli -- --models

${c('选项:', 'bold')}
  -a, --agent <id>            Agent 定义 id（默认 study-assistant）
  -m, --message "<text>"     发送给 Agent 的用户消息
  -c, --conversation-id <id> 续聊的会话 id（留空则新建，进程内有效）
  -l, --list                  列出所有可用 Agent
      --models                显示当前大模型配置状态
  -h, --help                  显示帮助

${c('大模型配置（运行前需先配置）', 'yellow')}
  在 servers/ai-service/.env 中设置：
    HY3_API_KEY=<你的 key>           # 腾讯混元（Tencent MaaS TokenHub）
    HY3_BASE_URL=https://tokenhub.tencentmaas.com/v1
    DEPSEEK_API_KEY=<你的 key>       # DeepSeek（可选）
  或用环境变量临时覆盖： export HY3_API_KEY=xxx
  运行时会自动检测所选 Agent 使用的模型是否已配置。
`);
}

function printWelcome(): void {
  console.log(c('╔════════════════════════════════════════════════════════╗', 'cyan'));
  console.log(c('║         科豆 AI · Agent Harness CLI  (shell 验证)        ║', 'cyan'));
  console.log(c('╚════════════════════════════════════════════════════════╝', 'cyan'));
}

function printModelStatus(harness: ReturnType<typeof buildStandaloneHarness>): void {
  console.log(c('\n大模型配置状态:', 'bold'));
  for (const m of harness.clientRegistry.listModels()) {
    const tag = m.available ? c('✓ 已配置', 'green') : c('✗ 未配置', 'red');
    console.log(`  ${tag}  ${c(m.id, 'cyan')}  (${m.displayName})`);
  }
  const anyReady = harness.clientRegistry.listModels().some((m) => m.available);
  if (!anyReady) {
    console.log(c('\n⚠️ 当前没有任何可用的大模型。请先配置 API Key（见下方），再运行 --message。', 'yellow'));
    printConfigHint();
  }
}

function printConfigHint(): void {
  console.log(c('配置方式（二选一）:', 'bold'));
  console.log('  1) 编辑 servers/ai-service/.env，填入 HY3_API_KEY / DEPSEEK_API_KEY');
  console.log('  2) 终端临时导出： export HY3_API_KEY=你的key');
  console.log(c('示例: export HY3_API_KEY=sk-xxxx', 'gray'));
}

/** 检查所选 Agent 的模型是否已配置；未配置则打印引导并退出 */
function ensureAgentModelReady(agent: AgentDefinition, harness: ReturnType<typeof buildStandaloneHarness>): void {
  const client = harness.clientRegistry.get(agent.model);
  if (client.isAvailable()) return;

  console.log(c(`\n❌ Agent "${agent.id}" 使用的模型 "${agent.model}" (${client.displayName}) 尚未配置。`, 'red'));
  console.log(c('  请先配置该模型的 API Key 后重试：', 'yellow'));
  printConfigHint();
  console.log(c(`\n已配置模型:`, 'bold'));
  for (const m of harness.clientRegistry.listModels()) {
    console.log(`  ${m.available ? c('✓', 'green') : c('✗', 'red')} ${m.id}`);
  }
  process.exit(1);
}

async function main(): Promise<void> {
  printWelcome();
  const opts = parseArgs(process.argv.slice(2));

  // --models / --list：仅展示，不要求配置（不消耗 token）
  if (opts.models || opts.list) {
    const harness = buildStandaloneHarness();
    if (opts.models) {
      printModelStatus(harness);
      return;
    }
    console.log(c('\n可用 Agent:', 'bold'));
    for (const agent of harness.agentRegistry.list()) {
      const modelReady = harness.clientRegistry.get(agent.model).isAvailable();
      const modelTag = modelReady ? c('模型就绪', 'green') : c('模型未配置', 'red');
      console.log(`  ${c(agent.id, 'cyan')}  ${agent.name}  [tools: ${agent.tools.join(', ')}]  (${modelTag})`);
    }
    printModelStatus(harness);
    if (!harness.clientRegistry.listModels().some((m) => m.available)) {
      console.log(c('\n提示：首次对话前会引导你配置大模型（保存在本机，不会消耗他人 token）。', 'yellow'));
    }
    return;
  }

  // 运行 --message：必须先完成大模型配置（交互引导），否则无法对话
  if (!opts.message.trim()) {
    console.error(c('错误：请提供 --message 参数', 'red'));
    printHelp();
    process.exit(1);
  }

  const cfg = await ensureConfig();
  applyConfigToEnv(cfg);
  const harness = buildStandaloneHarness();

  let agent: AgentDefinition;
  try {
    agent = harness.agentRegistry.get(opts.agent);
  } catch {
    console.error(c(`错误：未找到 Agent "${opts.agent}"，用 --list 查看可用项`, 'red'));
    process.exit(1);
  }

  ensureAgentModelReady(agent, harness);

  console.log(c(`\n[用户] ${opts.message}`, 'green'));
  if (opts.conversationId) {
    console.log(c(`(续聊会话: ${opts.conversationId})`, 'gray'));
  }
  console.log(c('─'.repeat(60), 'gray'));

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
        console.log(c(`\n🔧 调用工具: ${event.name}`, 'yellow'));
        console.log(c(`   参数: ${JSON.stringify(event.args)}`, 'gray'));
        break;
      case 'tool_result':
        console.log(c(`   结果: ${String(event.content).slice(0, 300)}`, 'gray'));
        break;
      case 'final':
        finalContent = event.content ?? '';
        conversationId = event.conversationId ?? conversationId;
        break;
      case 'error':
        console.log(c(`\n❌ 错误: ${event.content}`, 'red'));
        break;
      default:
        break;
    }
  }

  console.log(c('\n─'.repeat(60), 'gray'));
  console.log(c(`[Agent] ${finalContent}`, 'cyan'));
  if (conversationId) {
    console.log(c(`\n会话 ID: ${conversationId}（用 --conversation-id 续聊）`, 'bold'));
  }
}

main().catch((err) => {
  console.error(c(`CLI 运行失败: ${err.message}`, 'red'));
  process.exit(1);
});
