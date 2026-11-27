// 真实 Node http mock server（纯 http 模块，无第三方依赖）
// 按 token 节奏真吐 AGUI/SSE 事件。
//
// 本轮重点：**在 markdown 正文流的中途**打开 ```widget fence，逐字吐 JSON
// （并在中途故意停一下制造「半截」），闭合后继续吐普通 markdown（表格/代码/引用）。
// 因此能肉眼看到：正文 → 交互区块 → 正文继续逐字吐出。
//
// 启动：node server/mock-sse-server.mjs   （或 npm run server，默认 PORT=8799）
// 端口：8799（可用 PORT 覆写）   端点：GET/POST /agui 或 /sse

import http from 'node:http';

const PORT = Number(process.env.PORT || 8799);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const MID = 'msg_demo_1';

// 把一段文本切成若干 text_message_content 事件（chunkSize 个字符一帧）
function textTokens(str, messageId = MID, chunkSize = 2, delay = 18) {
  const out = [];
  for (let i = 0; i < str.length; i += chunkSize) {
    out.push({
      type: 'text_message_content',
      messageId,
      delta: str.slice(i, i + chunkSize),
      _delay: delay,
    });
  }
  return out;
}

/**
 * 一个 widget 声明的完整流式帧序列：
 *   ```widget\n  ->  逐字 JSON（中途故意长暂停 = 半截）  ->  \n```\n
 * 注意 fence 前后都会由调用方继续吐普通 markdown 正文。
 */
function widgetTokens(spec, { chunkSize = 1, delay = 14, pauseAt = 0.42, pauseMs = 420 } = {}) {
  const json = JSON.stringify(spec);
  const out = [
    { type: 'text_message_content', messageId: MID, delta: '```widget\n', _delay: 60 },
  ];
  const pauseIdx = Math.floor(json.length * pauseAt);
  for (let i = 0; i < json.length; i += chunkSize) {
    out.push({
      type: 'text_message_content',
      messageId: MID,
      delta: json.slice(i, i + chunkSize),
      // 故意在 JSON 半截处停一下：验证前端不会因半截 JSON 崩渲染 / 提前 import
      _delay: i === pauseIdx ? pauseMs : delay,
    });
  }
  out.push({ type: 'text_message_content', messageId: MID, delta: '\n```\n', _delay: 80 });
  return out;
}

const POLL_SPEC = {
  app: 'poll',
  props: {
    question: '选一个实现方案',
    options: ['自研 StreamingMarkdown', '引 bytemd', '引 Vercel AI SDK'],
  },
};
const CHART_SPEC = {
  app: 'chart',
  props: {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    names: ['本周', '上周'],
    series: [[32, 58, 44, 76, 61], [20, 40, 66, 38, 52]],
  },
};
const FORM_SPEC = { app: 'form', props: { placeholder: '输入一句话…' } };

const events = [
  { type: 'run_started', runId: 'run_1', threadId: 'th_1', _delay: 120 },
  { type: 'text_message_start', messageId: MID, _delay: 60 },

  // —— widget 之前的正文（保证 widget 帧前面有文本）——
  ...textTokens(
    '下面这段回答里，我会在**正文中间**插入一个可交互的微前端区块。\n\n',
    MID,
    24,
    20,
  ),

  // —— 第 1 个 widget：poll，逐字吐 JSON，中途故意半截 ——
  ...widgetTokens(POLL_SPEC, { chunkSize: 1, delay: 14, pauseMs: 420 }),

  // —— widget 之后的正文继续逐字吐出（关键验收点）——
  ...textTokens(
    '\n👆 上面虚线框里的按钮**可以点**：它不是代码块、也不是图片，而是 `System.import()` 运行时载入的 System.register 子应用。点击后下方会立刻回显一条系统消息；**注意后面的文字还在继续逐字吐出**，这个区块不会被重绘销毁。\n\n',
    MID,
    10,
    16,
  ),

  // 半截代码块（验证未闭合 fence 延迟渲染不崩）
  { type: 'text_message_content', messageId: MID, delta: '```ts\n', _delay: 40 },
  ...textTokens("import { aguiBus } from 'agui-bus';\n", MID, 4, 22),
  ...textTokens("aguiBus.on('widget_action', (e) => renderWidget(e.value));\n", MID, 4, 22),
  { type: 'text_message_content', messageId: MID, delta: '```\n', _delay: 60 },
  ...textTokens('\n（上方代码块在流式中曾处于「半截」状态，被安全延迟渲染。）\n\n', MID, 8, 18),

  // 表格
  ...textTokens('| 方案 | 优点 | 缺点 |\n', MID, 6, 20),
  ...textTokens('| --- | --- | --- |\n', MID, 6, 20),
  ...textTokens('| 稳定 block + :key | widget 不重建 | 需自行切块 |\n', MID, 6, 20),
  ...textTokens('| 整段 v-html | 实现简单 | 子应用被反复销毁 |\n', MID, 6, 20),
  ...textTokens('| System.register | 运行时按需加载 | 需种子注入 vue |\n\n', MID, 6, 20),

  // —— 第 2 个 widget：chart（明显不同的交互）——
  ...textTokens('再换一种交互：点击柱子会切换数据集。\n\n', MID, 8, 18),
  ...widgetTokens(CHART_SPEC, { chunkSize: 2, delay: 12, pauseMs: 260 }),

  // —— 第 3 个 widget：form（输入状态保持）——
  ...textTokens('\n最后是一个带输入框的表单，先输入几个字，等流跑完再回头看它还在不在。\n\n', MID, 8, 18),
  ...widgetTokens(FORM_SPEC, { chunkSize: 2, delay: 12, pauseMs: 220 }),

  // 引用 + 工具调用
  ...textTokens(
    '\n> 提示：子应用卸载时务必解绑 bus 监听，并从 Map<slotId, handle> 删除，否则内存泄漏 / 跨轮串台。\n',
    MID,
    8,
    18,
  ),
  { type: 'tool_call_start', toolCallId: 't_1', toolName: 'search_docs', _delay: 80 },
  ...textTokens('{"query":"System.register 样式穿透"}', MID, 4, 20).map((e) => ({
    type: 'tool_call_args',
    toolCallId: 't_1',
    delta: e.delta,
    _delay: e._delay,
  })),
  { type: 'tool_call_end', toolCallId: 't_1', _delay: 40 },

  {
    type: 'state_snapshot',
    snapshot: { needsConfirmation: true, step: 'confirm_render' },
    _delay: 80,
  },
  { type: 'text_message_end', messageId: MID, _delay: 40 },
  { type: 'run_finished', runId: 'run_1', threadId: 'th_1', _delay: 60 },
];

function writeEvent(res, evt) {
  res.write(`data: ${JSON.stringify(evt)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, sseHeaders());
    res.end();
    return;
  }

  const url = (req.url || '').split('?')[0];
  if (url === '/agui' || url === '/sse') {
    res.writeHead(200, sseHeaders());
    res.write('retry: 3000\n\n');

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    for (const evt of events) {
      if (aborted) break;
      const { _delay, ...wire } = evt;
      writeEvent(res, wire);
      await sleep(_delay || 20);
    }
    if (!aborted) res.write('event: done\ndata: {}\n\n');
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('AI Agent 流式 SSE mock server 运行中。访问 /agui 或 /sse 获取事件流。\n');
  }
});

server.listen(PORT, () => {
  process.stdout.write(`[mock-sse] AGUI/SSE mock server 已启动: http://localhost:${PORT}/agui (${events.length} 帧)\n`);
});
