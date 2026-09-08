/**
 * 合同翻译官 E2E 评测 · 运行器入口。
 *
 * 装配方式（关键决策）：不启动 Nest / 不连业务 DB —— 直接复用 agent-core 纯装配：
 *   - AgentEngine + AgentRunner + InMemoryConversationMemory（对话历史不入库，评测隔离）
 *   - contract-risk 的 4 个工具直接 new（仅 contract-cleaner 依赖 ClientRegistry）
 *   - TokenHubClient 从 .env（servers/ai-agent/.env）读取，key 不落代码
 * 好处：零 DB 污染、可在任意环境跑（只需 .env 有 TOKENHUB_*）。
 *
 * 用法：
 *   pnpm ts-node e2e/contract-risk/run-eval.ts --round 001 [--model deepseek/...] [--only <id>]
 *   真实评测每样本会真实调用 LLM（消耗 token），建议先 --only 单个样本验证链路。
 *
 * 使用红线安全写法：无 console / 无裸 any / 无占位标记字面。
 */

import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import {
  AgentEngine,
  AgentRunner,
  AgentRegistry,
  ClientRegistry,
  ToolRegistry,
  TokenHubClient,
  InMemoryConversationMemory,
} from '@kedouai/agent-core';
import { EvalManifest, EvalSample, EvalRoundResult, SampleRunResult } from './types';
import { evalManifest } from './fixtures/manifest';
import { evaluateRun } from './checker';
import { aggregate, renderReport } from './report';
import { parseContractReport } from '../../src/contract/contract-report.parser';
import { ContractRuleTool } from '../../src/contract/tools/contract-rule.tool';
import { ContractIrrTool } from '../../src/contract/tools/contract-irr.tool';
import { ContractCleanerTool } from '../../src/contract/tools/contract-cleaner.tool';
import { ContractBenchmarkTool } from '../../src/contract/tools/contract-benchmark.tool';
import { contractRiskAgent } from '../../src/contract/agents/contract-risk.agent';

/** CLI 参数 */
export interface EvalCliArgs {
  /** 评测轮号，用于报告目录名（如 001） */
  round: string;
  /** 被测模型名（默认取 manifest.model；可传带 deepseek/ 前缀的完整名） */
  model?: string;
  /** 每样本运行次数（默认 1；正式建议 2 取均值） */
  rounds?: number;
  /** dry 模式：只加载样本并自检，不消耗 token */
  dry?: boolean;
  /** 只跑指定样本 id（快速验证链路用） */
  only?: string;
}

/** 评测假用户（InMemory 记忆，不涉及真实用户体系） */
const EVAL_USER_ID = 'eval-runner';

/** 轻量 .env 加载：只把缺失的键补进 process.env（不覆盖已有值） */
function loadEnvFile(envPath: string): void {
  try {
    const text = readFileSync(envPath, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // 无 .env 时依赖进程已注入的环境变量
  }
}

/** 从 .env 读取 TokenHub 模型清单（带 deepseek/ 前缀的完整 modelId） */
function listTokenHubModels(): string[] {
  return (process.env.TOKENHUB_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 装载评测运行时（纯 agent-core 装配，不连 DB） */
export function buildRuntime(model: string) {
  const clientRegistry = new ClientRegistry();
  for (const m of listTokenHubModels()) {
    clientRegistry.register(new TokenHubClient(m));
  }
  const modelId =
    clientRegistry.listModels().find((x) => x.id === model)?.id ??
    clientRegistry.listModels()[0]?.id;
  if (!modelId) throw new Error('未找到可用模型（检查 TOKENHUB_MODELS / TOKENHUB_API_KEY）');

  const toolRegistry = new ToolRegistry();
  const agentRegistry = new AgentRegistry();
  const memory = new InMemoryConversationMemory();

  // 注册 contract-risk 的 4 个工具（与 AgentModule.onModuleInit 一致）
  const cleaner = new ContractCleanerTool(clientRegistry);
  toolRegistry.register(cleaner);
  toolRegistry.register(new ContractRuleTool());
  toolRegistry.register(new ContractIrrTool());
  toolRegistry.register(new ContractBenchmarkTool());
  agentRegistry.upsert(contractRiskAgent);

  const engine = new AgentEngine(clientRegistry, toolRegistry, agentRegistry, memory);
  const runner = new AgentRunner(engine);
  return { runner, modelId };
}

/**
 * 从 fixtures/texts/<id>.txt 读入正文，组装成可运行样本。
 * 找不到正文文件会在 dry 自检中报错（样本未就绪）。
 */
export function loadManifest(): { manifest: EvalManifest; samples: EvalSample[] } {
  const textsDir = join(__dirname, 'fixtures', 'texts');
  const samples: EvalSample[] = evalManifest.samples.map((s) => {
    let contractText: string | undefined;
    try {
      contractText = readFileSync(join(textsDir, `${s.id}.txt`), 'utf8');
    } catch {
      contractText = undefined;
    }
    return { ...s, contractText };
  });
  return { manifest: evalManifest, samples };
}

/** 样本集完整性自检（零 token）：正文存在、id 唯一、工具名合法、loan 参数合法 */
export function dryCheck(samples: EvalSample[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const knownTools = new Set([
    'contract-cleaner',
    'contract-rule',
    'contract-irr',
    'contract-benchmark',
  ]);
  for (const s of samples) {
    if (ids.has(s.id)) errors.push(`样本 id 重复：${s.id}`);
    ids.add(s.id);
    if (!s.contractText || s.contractText.trim().length < 50) {
      errors.push(`[${s.id}] 缺正文：fixtures/texts/${s.id}.txt 不存在或过短`);
    }
    for (const tool of [...(s.expectToolCalls ?? []), ...(s.expectToolOrder ?? [])]) {
      if (!knownTools.has(tool)) errors.push(`[${s.id}] 未知工具名：${tool}`);
    }
    if (s.truth.loan) {
      const { principal, upfrontFee = 0, periods, monthlyPayment } = s.truth.loan;
      if (principal <= 0 || periods <= 0 || monthlyPayment <= 0 || upfrontFee < 0) {
        errors.push(`[${s.id}] truth.loan 参数非法`);
      }
    }
  }
  return errors;
}

/** 真实运行单一样本：一次 Agent run → 事件收集 → 判定（复用传入 runtime，避免重复 build） */
export async function runSample(
  sample: EvalSample,
  runtime: { runner: AgentRunner; modelId: string },
): Promise<SampleRunResult> {
  const { runner, modelId } = runtime;
  const calls: string[] = [];
  let finalContent = '';
  let costTokens = 0;
  const startedAt = Date.now();

  const stream = runner.stream(
    { agentId: 'contract-risk', model: modelId, userInput: sample.contractText ?? '' },
    EVAL_USER_ID,
  );

  for await (const ev of stream) {
    if (ev.type === 'tool_call' && ev.name) calls.push(ev.name);
    else if (ev.type === 'final' && typeof ev.content === 'string') finalContent = ev.content;
    if (ev.usage?.totalTokens) costTokens = ev.usage.totalTokens;
  }

  const report = parseContractReport(finalContent);
  const result = evaluateRun(
    sample,
    report ? (report as unknown as Record<string, unknown>) : null,
    { calls, finalContent },
  );
  result.costTokens = costTokens;
  result.durationMs = Date.now() - startedAt;
  // 调试辅助：把 final 原文落盘到 <reportDir>/raw/<sampleId>.final.txt（每次 run 覆盖）
  saveRawFinal(sample.id, finalContent);
  if (!report) result.error = result.error ?? 'final 无法解析为报告';
  return result;
}

/** 保存 final 原文（仅失败或非 JSON 时也能留证；重复 run 覆盖同 id） */
function saveRawFinal(sampleId: string, finalContent: string): void {
  try {
    const { writeFileSync, mkdirSync } = require('fs') as typeof import('fs');
    const date = new Date().toISOString().slice(0, 10);
    const dir = resolve(__dirname, '../../../../.codebuddy/evals/reports/contract-risk', date, 'raw');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sampleId}.final.txt`), finalContent, 'utf8');
  } catch {
    // raw 落盘失败不阻塞评测
  }
}

/** 真实评测：逐样本 × rounds，汇总为 EvalRoundResult */
export async function runEval(args: EvalCliArgs): Promise<void> {
  const { samples: allSamples } = loadManifest();
  const samples = args.only
    ? allSamples.filter((s) => s.id === args.only)
    : allSamples;

  const errors = dryCheck(samples);
  if (errors.length) {
    for (const e of errors) process.stderr.write(`[dry-check] ${e}\n`);
    process.exitCode = 1;
    return;
  }
  if (!samples.length) {
    process.stderr.write(`[run-eval] 未找到样本：${args.only ?? '(全部为空)'}\n`);
    process.exitCode = 1;
    return;
  }

  if (args.dry) {
    process.stdout.write(`[dry] 样本集就绪：${samples.length} 份\n`);
    for (const s of samples) {
      process.stdout.write(
        `[dry] - ${s.id} (${s.scene}/${s.domain}) 正文 ${s.contractText?.length} 字\n`,
      );
    }
    process.stdout.write('[dry] 未发起任何 LLM 调用\n');
    return;
  }

  // 真实评测
  const models = listTokenHubModels();
  const modelArg = args.model?.trim();
  const chosen =
    (modelArg && models.find((m) => m === modelArg)) ||
    (modelArg && models.find((m) => m.endsWith(`/${modelArg}`) || m.endsWith(modelArg))) ||
    modelArg ||
    models[0] ||
    evalManifest.model;
  process.stderr.write(`[run-eval] 模型=${chosen} 样本=${samples.length} 轮次/样本=${args.rounds ?? 1}\n`);

  // 构建一次 runtime，全部样本复用（Agent 工具注册是幂等且只读）
  const runtime = buildRuntime(chosen);
  process.stderr.write(`[run-eval] 运行时就绪，注册模型=${runtime.modelId}\n`);

  const runs: SampleRunResult[] = [];
  for (const sample of samples) {
    const loop = args.rounds ?? 1;
    for (let i = 0; i < loop; i++) {
      const start = Date.now();
      const r = await runSample(sample, runtime);
      const groupOk = r.ok; // 报告能解析才算结构可评
      process.stderr.write(
        `[run] ${sample.id} ${i + 1}/${loop} → ${r.passed ? 'PASS' : 'FAIL'} ` +
          `(结构${groupOk ? '可评' : '不可评'}/通过=${r.passed ? 'Y' : 'N'}) ` +
          `tokens=${r.costTokens ?? 0} ${((Date.now() - start) / 1000).toFixed(1)}s${r.error ? ` err=${r.error}` : ''}\n`,
      );
      runs.push(r);
    }
  }

  const round: EvalRoundResult = aggregate(runs, chosen, args.round);
  const markdown = renderReport(round);
  writeReportFile(markdown, args.round);
}

/** 报告落盘到 .codebuddy/evals/reports/contract-risk/<YYYY-MM-DD>/ */
function writeReportFile(markdown: string, roundDir: string): void {
  const { writeFileSync, mkdirSync } = require('fs') as typeof import('fs');
  const date = new Date().toISOString().slice(0, 10);
  const dir = resolve(__dirname, '../../../../.codebuddy/evals/reports/contract-risk', date);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${roundDir}.md`);
  writeFileSync(file, markdown, 'utf8');
  process.stderr.write(`[report] 已写入 ${file}\n`);
}

/** 直接执行入口（node/ts-node 运行本文件时调用，argv[1] 即本文件绝对路径） */
if (process.argv[1] && process.argv[1] === __filename) {
  // 先加载 servers/ai-agent/.env（run-eval 位于 e2e/contract-risk，上两级即 ai-agent 根）
  loadEnvFile(resolve(__dirname, '../../.env'));
  const args = parseArgv(process.argv.slice(2));
  runEval(args).catch((err: Error) => {
    process.stderr.write(`[run-eval] 失败: ${err.message}\n`);
    process.exitCode = 1;
  });
}

/** 极简 argv 解析（不引第三方库） */
function parseArgv(argv: string[]): EvalCliArgs {
  const out: EvalCliArgs = { round: '000' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--round' && argv[i + 1]) out.round = argv[++i];
    else if (a === '--model' && argv[i + 1]) out.model = argv[++i];
    else if (a === '--rounds' && argv[i + 1]) out.rounds = Number(argv[++i]);
    else if (a === '--dry') out.dry = true;
    else if (a === '--only' && argv[i + 1]) out.only = argv[++i];
  }
  return out;
}
