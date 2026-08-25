#!/usr/bin/env node
/**
 * kedou-agent CLI 入口。
 */
import { ensureConfig, applyConfigToEnv, loadConfig } from './config-store';
import { buildHarness } from './harness';
import { runChat } from './commands/chat';
import { runRepl } from './commands/repl';
import { runConfig } from './commands/config';
import { runAgents } from './commands/agents';
import { runModels } from './commands/models';

const VERSION = '0.1.0';

function printBanner(): void {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║         科豆 AI · kedou-agent CLI   (v' + VERSION + ')          ║');
  console.log('╚════════════════════════════════════════════════════════╝');
}

function printHelp(): void {
  console.log(`
kedou-agent —— 科豆 AI Agent CLI

用法:
  kedou-agent                          进入交互式 REPL 对话
  kedou-agent chat [--agent <id>]      交互对话
  kedou-agent config                   配置大模型 / 搜索 API
  kedou-agent agents                   列出可用 Agent
  kedou-agent models                   显示模型配置状态
  kedou-agent --message "<text>" [-a id] [-c convId]   单轮非交互
  kedou-agent --version / -v
  kedou-agent --help / -h

说明:
  大模型 API key 保存在本机 ~/.kedou，仅本人可读，不会上传也不会随包发布。
  未配置大模型时无法对话，运行会引导你配置。
`);
}

interface Args {
  message?: string;
  agent?: string;
  conversationId?: string;
  cmd?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--message' || x === '-m') a.message = argv[++i];
    else if (x === '--agent' || x === '-a') a.agent = argv[++i];
    else if (x === '--conversation-id' || x === '-c') a.conversationId = argv[++i];
    else if (x === '--version' || x === '-v') a.cmd = 'version';
    else if (x === '--help' || x === '-h') a.cmd = 'help';
    else if (x === 'config') a.cmd = 'config';
    else if (x === 'agents') a.cmd = 'agents';
    else if (x === 'models') a.cmd = 'models';
    else if (x === 'chat') a.cmd = 'chat';
    else if (x === 'repl') a.cmd = 'chat';
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // 纯信息命令，不要求配置
  if (args.cmd === 'help') {
    printHelp();
    return;
  }
  if (args.cmd === 'version') {
    console.log(VERSION);
    return;
  }
  if (args.cmd === 'agents' || args.cmd === 'models') {
    // 查看命令：注入已存配置，使模型就绪状态准确反映 ~/.kedou
    const cfg = loadConfig();
    if (cfg) applyConfigToEnv(cfg);
    printBanner();
    if (args.cmd === 'agents') runAgents();
    else runModels();
    return;
  }
  if (args.cmd === 'config') {
    printBanner();
    await runConfig();
    return;
  }

  // 对话类：必须先配置
  if (args.cmd === 'chat' && !args.message) {
    printBanner();
    const cfg = await ensureConfig();
    applyConfigToEnv(cfg);
    const harness = buildHarness((m) => replConfirm(m));
    await runRepl(harness, args.agent);
    return;
  }

  // 单轮 --message
  if (args.message) {
    printBanner();
    const cfg = await ensureConfig();
    applyConfigToEnv(cfg);
    const harness = buildHarness((m) => promptConfirm(m));
    await runChat(harness, args.agent, args.message, args.conversationId);
    return;
  }

  // 无参数 → 默认 REPL
  printBanner();
  const cfg = await ensureConfig();
  applyConfigToEnv(cfg);
  const harness = buildHarness((m) => replConfirm(m));
  await runRepl(harness);
}

/** 非交互 confirm：直接返回 false（默认拒绝危险操作） */
async function promptConfirm(_m: string): Promise<boolean> {
  return false;
}

/** 交互 confirm：readline 弹 [y/N] */
async function replConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const readline = require('readline') as typeof import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === 'y' || ans.trim().toLowerCase() === 'yes');
    });
  });
}

main().catch((err) => {
  console.error(`kedou-agent 运行失败: ${err.message}`);
  process.exit(1);
});
