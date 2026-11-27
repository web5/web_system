// ---------------------------------------------------------------------------
// demo-backend（8798）——「SSE 流式 Markdown 微前端 demo」的真实后台
//
// 两个职责（单文件纯 Node ESM、零框架，与 mock-sse-server.mjs 同风格）：
//   1) POST /agui：SSE 转译层。向上用 demo 账号登录 auth-service(6101) 换 JWT
//      （内存缓存 + 4010 信封清缓存重登重试一次），带 Bearer 调 ai-agent(6010)
//      /agent/run 真 LLM 流式，把上游 11 种 StreamEvent 逐帧转译成 demo 前端
//      吃的 AGUI 帧；其中 present-widget 的 tool_result 经白名单校验后插入
//      ```widget fence（LLM 输出任意内容都突不破前端安全边界）。
//   2) /api/widgets/*：poll / chart / form 三个子组件的数据接口
//      （JSON 文件持久化，demo 语义；投票计数 read-modify-write 同一 tick）。
//
// 启动：npm run server:real（由启动进程从 ~/env_config/ 注入 DEMO_USERNAME/
//       DEMO_PASSWORD，本文件只读 process.env，不回显、不打印任何凭证值）
// 端口：8798（可用 DEMO_BACKEND_PORT 覆写）
// 方案依据：30-任务产物/2026-11-13-SSE流式Markdown微前端-方案定稿与交接/06-真实后台接线方案.md
// ---------------------------------------------------------------------------

import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.DEMO_BACKEND_PORT || 8798);
const AI_AGENT_URL = (process.env.AI_AGENT_URL || 'http://127.0.0.1:6010').replace(/\/+$/, '');
const AUTH_SERVICE_URL = (process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:6101').replace(/\/+$/, '');
/** 必须显式传 demo agent id：传 'auto' 会被 IntentService 路由到生产 agent（06 §7 风险 7） */
const AGENT_ID = process.env.DEMO_AGENT_ID || 'widget-demo';
/** source='tool'：标记后不进生产对话列表，防污染（06 §7 风险 6） */
const RUN_SOURCE = 'tool';

/**
 * 默认演示提问：demo 前端目前不带上行输入框（sse-client 固定 POST body '{}'），
 * 请求体里带了 userInput/message 字段就用前端的，否则用这句默认 prompt。
 * （judgment call：等前端加输入框后可去掉默认值，见汇报「遗留」。）
 */
const DEFAULT_USER_INPUT =
  '请帮我演示这个微前端 demo：先用 poll 组件发起一个「选一个实现方案」的投票（选项：自研 StreamingMarkdown、引 bytemd、引 Vercel AI SDK），' +
  '再用 chart 组件展示本周与上周的访问量对比，最后用 form 组件让我输入一句话。每个组件前后都要有正文说明。';

// ---------------------------------------------------------------------------
// JWT：demo 账号登录 auth-service 换 token，内存缓存；4010 信封 → 清缓存重登重试一次
// ---------------------------------------------------------------------------

/** @type {{ accessToken: string | null; expiresAt: number }} */
const tokenCache = { accessToken: null, expiresAt: 0 };

async function login() {
  const username = process.env.DEMO_USERNAME ?? '';
  const password = process.env.DEMO_PASSWORD ?? '';
  if (!username || !password) {
    // 凭证只应由启动进程从 ~/env_config/ 注入；这里只报「未配置」，绝不回显值
    throw new Error('DEMO_USERNAME/DEMO_PASSWORD 未配置（启动进程应从 ~/env_config/ 注入，见 package.json server:real）');
  }
  const res = await fetch(`${AUTH_SERVICE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`auth-service 登录 HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  const accessToken = data?.accessToken;
  if (!accessToken) throw new Error('auth-service 登录响应缺少 accessToken');
  // TTL 7d；提前 5 分钟续，避免流中过期
  const expiresIn = Number(data?.expiresIn ?? 7 * 24 * 3600);
  tokenCache.accessToken = accessToken;
  tokenCache.expiresAt = Date.now() + Math.max(60, expiresIn - 300) * 1000;
  return accessToken;
}

/** 取 token：无凭证时不抛（返回 null），让请求走到上游收 4010 信封再走重登路径。 */
async function getToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt) return tokenCache.accessToken;
  try {
    return await login();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AGUI 帧发射 + S1 转译（11 种 StreamEvent → AGUI，06 §3 映射表 + 5 条评审缺漏）
// ---------------------------------------------------------------------------

/** widget 白名单 + props 净化：与 src/lib/widget-protocol.ts 的 parseWidgetSpec 等价复刻。 */
const WIDGET_REGISTRY = { poll: 1, chart: 1, form: 1 };
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 只允许 JSON 数据形状（函数/undefined/Symbol 剔除，深度 ≤6，原型污染键剔除）。 */
function sanitizeValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') return value;
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      const clean = sanitizeValue(v, depth + 1);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return null;
}

/** 解析 widget fence JSON：非法/半截/白名单外 → null（绝不抛错）。 */
function parseWidgetSpec(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed;
  if (typeof obj.app !== 'string' || !Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, obj.app)) {
    return null;
  }
  let props = {};
  if (obj.props !== undefined) {
    if (!obj.props || typeof obj.props !== 'object' || Array.isArray(obj.props)) return null;
    props = sanitizeValue(obj.props);
  }
  return { app: obj.app, props };
}

function str(v) {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

/** tool_call.args 可能是对象：stringify 成 delta 字符串（缺漏②）。 */
function safeStringifyArgs(args) {
  if (args === undefined || args === null) return '{}';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args);
  } catch {
    return '{}';
  }
}

/**
 * 转译器：把上游 StreamEvent 流转成下游 AGUI 帧。
 * 5 条评审缺漏落点（06 §3「rd-engineer 评审补正」）：
 *   ① run_started 合成首帧           —— start()
 *   ② tool_call 合成 toolCallId + args stringify —— handle() case 'tool_call'
 *   ③ fence 收口前正文不以 \n 结尾先补 \n     —— pushWidgetFence()
 *   ④ present-widget tool_result 过白名单才插 fence，否则降级普通文本 —— handle() case 'tool_result'
 *   ⑤ 上游 error/final → run_error / text_message_end + run_finished —— handle()/finish()/runError()
 * 另有：上游 : keepalive 注释行在 pump() 里跳过。
 */
function createTranslator(res, meta) {
  const { runId, threadId, messageId } = meta;
  /** ③：正文 delta 序列当前是否停在行首（初始无正文，视为行首） */
  let tailAtLineStart = true;
  /** 终态幂等：final/error 只收口一次 */
  let sawTerminal = false;
  let toolSeq = 0;
  let currentToolCallId = null;
  // 上游事件若自带 runId/threadId 则采用，否则用合成的
  const ids = { runId, threadId };

  const frame = (evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  };

  const pushText = (delta) => {
    if (typeof delta !== 'string' || delta.length === 0) return;
    frame({ type: 'text_message_content', messageId, delta });
    tailAtLineStart = delta.endsWith('\n');
  };

  /** ③④：白名单通过 → 插 ```widget fence；保证 fence 落在行首（markdown-blocks.ts:24 FENCE_OPEN 约束） */
  const pushWidgetFence = (spec) => {
    const prefix = tailAtLineStart ? '' : '\n';
    pushText(`${prefix}\`\`\`widget\n${JSON.stringify({ app: spec.app, props: spec.props })}\n\`\`\`\n`);
    tailAtLineStart = true;
  };

  const start = () => {
    // ① 上游没有 run_started；前端 AgentPanel 靠它置 thinking 态并建消息
    frame({ type: 'run_started', runId: ids.runId, threadId: ids.threadId });
    frame({ type: 'text_message_start', messageId, role: 'assistant' });
  };

  const finish = () => {
    if (sawTerminal) return;
    sawTerminal = true;
    frame({ type: 'text_message_end', messageId });
    frame({ type: 'run_finished', runId: ids.runId, threadId: ids.threadId });
  };

  const runError = (message) => {
    if (sawTerminal) return;
    sawTerminal = true;
    frame({ type: 'run_error', message: String(message).slice(0, 500) });
  };

  const handle = (ev) => {
    if (!ev || typeof ev !== 'object') return;
    if (typeof ev.runId === 'string' && ev.runId) ids.runId = ev.runId;
    if (typeof ev.threadId === 'string' && ev.threadId) ids.threadId = ev.threadId;

    switch (ev.type) {
      case 'content_delta':
        // 字段名防御性读取：delta/content/text（联调后可按上游真相源收窄）
        pushText(str(ev.delta ?? ev.content ?? ev.text));
        break;
      case 'reasoning_delta':
        break; // demo 无思维链展示区，丢弃（避免污染正文）
      case 'tool_call': {
        // ② 上游 StreamEvent 只有 name/args/step：合成 toolCallId + args stringify
        const toolCallId = `tc_${Date.now().toString(36)}_${++toolSeq}`;
        currentToolCallId = toolCallId;
        frame({ type: 'tool_call_start', toolCallId, toolName: str(ev.name) || 'tool' });
        frame({ type: 'tool_call_args', toolCallId, delta: safeStringifyArgs(ev.args) });
        break;
      }
      case 'tool_result': {
        if (currentToolCallId) {
          frame({ type: 'tool_call_end', toolCallId: currentToolCallId });
          currentToolCallId = null;
        }
        if (str(ev.name) === 'present-widget') {
          // ④ 工具产出的结构化 UI：过白名单才插 fence，否则降级普通文本
          const spec = parseWidgetSpec(str(ev.content));
          if (spec) pushWidgetFence(spec);
          else pushText(str(ev.content));
        }
        break;
      }
      case 'final': {
        // ⑤ final 若带尾内容则先落正文，再收口
        const tail = str(ev.delta ?? ev.content ?? ev.text);
        if (tail) pushText(tail);
        finish();
        break;
      }
      case 'error':
        // ⑤ 4010 等鉴权失败在流内也会以 error 事件出现
        runError(str(ev.message ?? ev.content ?? ev.detail) || '上游 error（无 message）');
        break;
      case 'intent':
        // 映射为 state_snapshot 便于排查路由；不置 needsConfirmation（不会把 UI 打成 waiting）
        frame({
          type: 'state_snapshot',
          snapshot: { intent: str(ev.intent ?? ev.to ?? ev.name) || 'unknown', agentId: AGENT_ID },
        });
        break;
      case 'permission_request':
        // demo 账号无高危工具：权限请求直接转 error（06 §3 映射表）
        runError(`上游请求权限（${str(ev.name ?? ev.tool) || 'unknown'}）——demo 账号无高危工具，已中断`);
        break;
      case 'summary':
      case 'skill_load':
      case 'card':
        break; // demo 场景无消费方，丢弃
      default:
        break; // 未知事件类型静默丢弃（不猜形状）
    }
  };

  /** 逐行解析上游 SSE：跳过 : keepalive 注释行，只取 data: 行。 */
  const pump = async (response) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawFrame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of rawFrame.split('\n')) {
          if (!line || line.startsWith(':')) continue; // : keepalive 注释
          if (!line.startsWith('data:')) continue; // event:/id:/retry: 行
          const payload = line.slice(5).replace(/^ /, '');
          if (!payload) continue;
          let ev = null;
          try {
            ev = JSON.parse(payload);
          } catch {
            continue;
          }
          handle(ev);
        }
      }
    }
    // 上游流结束但没收口（无 final/error）：兜底 finish，否则前端永远 thinking
    finish();
  };

  return { start, finish, runError, pump };
}

// ---------------------------------------------------------------------------
// POST /agui：调上游 + 4010 信封识别/重登重试一次 + 转译下行
// ---------------------------------------------------------------------------

/** guard 层 401 被 unified-exception.filter 包成 HTTP 200 + JSON 信封：靠 Content-Type 区分。 */
function isJsonEnvelope(res) {
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json');
}

/**
 * 调 ai-agent /agent/run。
 * 正确顺序（06 §3 JWT 过期顺序）：4010 信封 → 清缓存重登 → 重试一次 → 仍失败才 run_error。
 * @returns {{ kind: 'stream', response: Response } | { kind: 'error', message: string }}
 */
async function callAgentRun(userInput, setUpstreamController) {
  const body = JSON.stringify({ agentId: AGENT_ID, userInput, source: RUN_SOURCE });
  const doFetch = (token) => {
    const controller = new AbortController();
    setUpstreamController(controller);
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (token) headers.Authorization = `Bearer ${token}`;
    // 只给「响应头」设超时；头到了就清除，避免掐断正常长流
    const timer = setTimeout(() => controller.abort(new Error('上游响应头超时(30s)')), 30000);
    return fetch(`${AI_AGENT_URL}/agent/run`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
      .then((r) => {
        clearTimeout(timer);
        return r;
      })
      .catch((e) => {
        clearTimeout(timer);
        throw e;
      });
  };

  let token = await getToken();
  let retried = false;
  for (;;) {
    let res;
    try {
      res = await doFetch(token);
    } catch (e) {
      return { kind: 'error', message: `请求上游失败：${e.message}` };
    }

    if (isJsonEnvelope(res)) {
      const env = await res.json().catch(() => null);
      const code = env?.code ?? 'unknown';
      const msg = env?.message ?? '未知错误';
      if (!retried) {
        retried = true;
        tokenCache.accessToken = null; // 清缓存
        tokenCache.expiresAt = 0;
        try {
          token = await login(); // 强制重登
          continue; // 重试一次
        } catch (e) {
          return {
            kind: 'error',
            message: `上游拒绝（信封 code=${code}: ${msg}）；清缓存重登失败：${e.message}`,
          };
        }
      }
      return { kind: 'error', message: `上游拒绝（信封 code=${code}: ${msg}）；已重登重试一次仍失败` };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { kind: 'error', message: `上游 HTTP ${res.status}：${text.slice(0, 200)}` };
    }
    return { kind: 'stream', response: res };
  }
}

async function handleAgui(req, res) {
  // 前端消息：body.userInput / body.message 优先（sse-client 现状发 '{}' → 用默认 prompt）
  let userInput = DEFAULT_USER_INPUT;
  try {
    const body = await readJsonBody(req);
    if (typeof body.userInput === 'string' && body.userInput.trim()) userInput = body.userInput.trim();
    else if (typeof body.message === 'string' && body.message.trim()) userInput = body.message.trim();
  } catch {
    /* 坏 body 不阻断：用默认 prompt */
  }

  res.writeHead(200, sseHeaders());
  res.write('retry: 3000\n\n');

  const now = Date.now().toString(36);
  const translator = createTranslator(res, {
    runId: `run_${now}`,
    threadId: `th_${now}`,
    messageId: `msg_${now}`,
  });
  translator.start();

  // 下游断开 → 放弃上游连接，避免孤儿流
  let upstreamController = null;
  const onClose = () => upstreamController?.abort();
  req.on('close', onClose);

  try {
    const upstream = await callAgentRun(userInput, (c) => {
      upstreamController = c;
    });
    if (upstream.kind === 'error') translator.runError(upstream.message);
    else await translator.pump(upstream.response);
  } catch (err) {
    translator.runError(`demo-backend 内部错误：${err?.message ?? String(err)}`);
  } finally {
    req.off('close', onClose);
    // 与 mock 对齐的收尾帧（sse-client 只认 data: 行，无害）
    res.write('event: done\ndata: {}\n\n');
    res.end();
  }
}

// ---------------------------------------------------------------------------
// /api/widgets/*：三个子组件数据接口（JSON 文件持久化，demo 语义）
// ---------------------------------------------------------------------------

const DATA_FILE = fileURLToPath(new URL('./data/widgets.json', import.meta.url));

/** @type {{ poll: { question: string; options: Array<{id:string;label:string;votes:number}> }; chart: Record<string, {labels:string[];names:string[];series:number[][]}>; form: { placeholder: string; submissions: Array<{value:string;at:string}> } }} */
let store = loadStore();

function loadStore() {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    // 数据文件损坏也不崩进程：回退内置最小集（重启后可修复文件）
    process.stderr.write(`[demo-backend] 读取 ${DATA_FILE} 失败（${e.message}），使用内置默认数据\n`);
    return {
      poll: { question: '选一个实现方案', options: [] },
      chart: {},
      form: { placeholder: '输入一句话…', submissions: [] },
    };
  }
}

/** 同步写盘：与内存修改同一 tick 完成，杜绝异步交错丢更新（06 §4 评审补正③）。 */
function persist() {
  writeFileSync(DATA_FILE, `${JSON.stringify(store, null, 2)}\n`);
}

function totalVotes() {
  return store.poll.options.reduce((sum, o) => sum + (Number(o.votes) || 0), 0);
}

function pollSnapshot() {
  return {
    question: store.poll.question,
    options: store.poll.options.map((o) => ({ id: o.id, label: o.label, votes: Number(o.votes) || 0 })),
    total: totalVotes(),
  };
}

function handleChart(u, res) {
  const range = u.searchParams.get('range') || 'week';
  const ds = store.chart[range];
  if (!ds) {
    return sendJson(res, 400, { ok: false, error: `range 必须是 ${Object.keys(store.chart).join('|')}` });
  }
  sendJson(res, 200, { range, labels: ds.labels, names: ds.names, series: ds.series });
}

function formSnapshot() {
  return {
    placeholder: store.form.placeholder,
    schema: { type: 'object', properties: { message: { type: 'string', maxLength: 500 } } },
  };
}

async function handleVote(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: e.message });
  }
  const optionId = typeof body.optionId === 'string' ? body.optionId : '';
  const opt = store.poll.options.find((o) => o.id === optionId);
  if (!opt) {
    return sendJson(res, 404, { ok: false, error: `未知 optionId: ${optionId || '(空)'}` });
  }
  opt.votes = (Number(opt.votes) || 0) + 1; // read-modify-write 同一 tick
  persist(); // 同步落盘
  sendJson(res, 200, { ok: true, optionId: opt.id, votes: opt.votes, total: totalVotes() });
}

async function handleFormSubmit(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: e.message });
  }
  const value = typeof body.value === 'string' ? body.value : typeof body.message === 'string' ? body.message : '';
  if (!value.trim()) return sendJson(res, 400, { ok: false, error: 'value 不能为空' });
  const entry = { value: value.slice(0, 500), at: new Date().toISOString() };
  store.form.submissions.unshift(entry);
  store.form.submissions = store.form.submissions.slice(0, 50); // 只留最近 50 条
  persist();
  sendJson(res, 200, { ok: true, echo: entry });
}

// ---------------------------------------------------------------------------
// HTTP 基础设施（响应头/body 读取照 mock 口径）
// ---------------------------------------------------------------------------

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Mcp-Key',
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Mcp-Key',
    'Access-Control-Max-Age': '600',
  };
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(),
  });
  res.end(JSON.stringify(obj));
}

/** 读 JSON body（限 64KB，防空包打爆内存）。 */
function readJsonBody(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大(>64KB)'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // 下游写失败（客户端提前断开）不能崩进程
  res.on('error', () => {});

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const u = new URL(req.url || '/', 'http://localhost');
  const path = u.pathname;

  try {
    if (path === '/agui' || path === '/sse') return await handleAgui(req, res);
    if (path === '/healthz') {
      return sendJson(res, 200, {
        status: 'ok',
        agentId: AGENT_ID,
        hasCachedToken: Boolean(tokenCache.accessToken),
      });
    }
    if (path === '/api/widgets/poll' && req.method === 'GET') return sendJson(res, 200, pollSnapshot());
    if (path === '/api/widgets/poll/vote' && req.method === 'POST') return await handleVote(req, res);
    if (path === '/api/widgets/chart' && req.method === 'GET') return handleChart(u, res);
    if (path === '/api/widgets/form' && req.method === 'GET') return sendJson(res, 200, formSnapshot());
    if (path === '/api/widgets/form' && req.method === 'POST') return await handleFormSubmit(req, res);
    if (path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(
        'demo-backend 运行中。POST /agui（SSE 转译）· GET /api/widgets/poll|chart?range=week|month|form · POST /api/widgets/poll/vote\n',
      );
    }
    sendJson(res, 404, { ok: false, error: `Not Found: ${req.method} ${path}` });
  } catch (err) {
    // 兜底：单个坏请求绝不让进程崩
    sendJson(res, 500, { ok: false, error: `demo-backend 内部错误：${err?.message ?? String(err)}` });
  }
});

process.on('unhandledRejection', (e) => {
  process.stderr.write(`[demo-backend] unhandledRejection: ${e?.message ?? String(e)}\n`);
});

server.listen(PORT, () => {
  // 注意：不用 console.log（仓库红线 R1 扫调试残留）；启动信息走 stdout
  process.stdout.write(
    `[demo-backend] 已启动: http://localhost:${PORT}  /agui → ${AI_AGENT_URL}/agent/run (agentId=${AGENT_ID}, source=${RUN_SOURCE})  登录: ${AUTH_SERVICE_URL}/auth/login  数据: ${DATA_FILE}\n`,
  );
});
