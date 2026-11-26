/**
 * 🔵 RD 独立盲测 E 组：services/tts 的 same-text 契约（用**真模块**，不用 mock）
 *
 * 为什么单独测：首页页脚「■ 停止」不是显式 stopSpeak()，而是 `speakQuote()` →
 * `speakText(同一句文本)`，靠 tts 内建的 same-text 语义停播。若该契约不成立，
 * 用户点「停止」会**从头重播一遍**（比不停更糟）。这条不能靠读代码推断。
 */
jest.mock('../utils/request', () => ({
  getToken: jest.fn(() => 'token-abc'),
  isLoggedOut: jest.fn(() => false),
}));

type Listeners = Array<(s: { text: string; phase: string } | null) => void>;

const states: Array<{ text: string; phase: string } | null> = [];
const requests: Array<{ url: string; method: string }> = [];
const tasks: any[] = [];
const contexts: any[] = [];
const sources: any[] = [];

function makeRequestTask(onChunk: (cb: (c: { data: ArrayBuffer }) => void) => void) {
  const task: any = {
    abort: jest.fn(),
    onChunkReceived: (cb: (c: { data: ArrayBuffer }) => void) => onChunk(cb),
  };
  tasks.push(task);
  return task;
}

const wxMock: any = {
  getStorageSync: jest.fn(() => ''),
  env: { USER_DATA_PATH: '/tmp' },
  request: jest.fn((opt: any) => {
    requests.push({ url: opt.url, method: opt.method });
    if (String(opt.url).endsWith('/api/ai/tts/stream')) {
      // 立即给一片合法 pcm（首字节不是 '{'）→ 流式判定成功
      return makeRequestTask((cb) => {
        const buf = new Uint8Array([1, 2, 3, 4]).buffer;
        setTimeout(() => cb({ data: buf }), 0);
      });
    }
    // 整段方案：返回一个可播的 mp3 字节
    setTimeout(() => opt.success && opt.success({ statusCode: 200, data: new Uint8Array([0xff, 0xfb]).buffer, header: {} }), 0);
    return { abort: jest.fn() };
  }),
  createWebAudioContext: jest.fn(() => {
    const ctx: any = {
      state: 'running',
      currentTime: 0,
      destination: {},
      createBuffer: (ch: number, len: number, sr: number) => ({
        duration: len / sr,
        getChannelData: () => new Float32Array(len),
      }),
      createBufferSource: () => {
        const src: any = { buffer: null, connect: jest.fn(), start: jest.fn(), stop: jest.fn(), onended: undefined };
        sources.push(src);
        return src;
      },
      close: jest.fn(),
      resume: jest.fn(),
    };
    contexts.push(ctx);
    return ctx;
  }),
  createInnerAudioContext: jest.fn(() => ({
    src: '',
    play: jest.fn(),
    stop: jest.fn(),
    destroy: jest.fn(),
    onEnded: jest.fn(),
    onError: jest.fn(),
  })),
  getFileSystemManager: () => ({
    accessSync: () => { throw new Error('ENOENT'); },
    writeFile: (o: any) => o.success && o.success(),
    readdirSync: () => [],
    statSync: () => ({ lastModifiedTime: 0 }),
    unlinkSync: jest.fn(),
  }),
  getApp: () => ({ globalData: { apiBase: 'https://api.test' } }),
  showToast: jest.fn(),
};

let tts: any;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = () => ({ globalData: { apiBase: 'https://api.test' } });
  tts = require('../services/tts');
  tts.onSpeakState((s: any) => states.push(s));
});

beforeEach(() => {
  jest.clearAllMocks();
  requests.length = 0;
  states.length = 0;
  tasks.length = 0;
  contexts.length = 0;
  sources.length = 0;
  tts.stopSpeak();
  requests.length = 0;
  states.length = 0;
});

const flush = () => new Promise((r) => setTimeout(r, 10));

describe('E1 同一文本再点 = 停止（不重播）', () => {
  it('播 A → 再 speakText(A) → 返回 false、推 null、**不发起任何新合成请求**', async () => {
    const ok1 = await tts.speakText('I never get up early on Sundays.');
    await flush();
    expect(ok1).toBe(true);
    const reqAfterFirst = requests.length;
    expect(reqAfterFirst).toBeGreaterThan(0);

    const ok2 = await tts.speakText('I never get up early on Sundays.');
    await flush();

    expect(ok2).toBe(false);                       // 本次是「停止」而不是「播放」
    expect(requests.length).toBe(reqAfterFirst);   // 🔴 没有重新合成 → 不会从头播一遍
    expect(states[states.length - 1]).toBeNull();  // 播放态归零，页面按钮回到「▶ 朗读」
  });

  it('首尾空白不影响 same-text 判定（首页传的是原文，tts 内部 trim）', async () => {
    await tts.speakText('Early');
    await flush();
    const n = requests.length;
    const ok = await tts.speakText('  Early  ');
    expect(ok).toBe(false);
    expect(requests.length).toBe(n);
  });

  it('播放中改播另一段 → 顶掉上一段（新请求 +1，状态换成新文本）', async () => {
    await tts.speakText('Early');
    await flush();
    const n = requests.length;
    const ok = await tts.speakText('Sundays');
    await flush();
    expect(ok).toBe(true);
    expect(requests.length).toBeGreaterThan(n);
    const last = states.filter(Boolean).pop() as any;
    expect(last.text).toBe('Sundays');
  });
});

describe('E2 「停止」是真停（不是只把状态清零）', () => {
  it('再点同一句 → 流式请求被 abort、已排队音源被 stop、WebAudio 被 close', async () => {
    await tts.speakText('I never get up early on Sundays.');
    await flush();
    expect(sources.length).toBeGreaterThan(0);
    const task = tasks[tasks.length - 1];
    const ctx = contexts[contexts.length - 1];
    expect(task.abort).not.toHaveBeenCalled();

    await tts.speakText('I never get up early on Sundays.');

    expect(task.abort).toHaveBeenCalled();                       // 在途合成被掐断
    expect(sources.every((s2) => s2.stop.mock.calls.length > 0)).toBe(true); // 已入队分片被停
    expect(ctx.close).toHaveBeenCalled();                        // 音频上下文被释放
  });
});

describe('E2b 边界', () => {
  it('空文本 / 纯空白 → false 且不发请求', async () => {
    expect(await tts.speakText('')).toBe(false);
    expect(await tts.speakText('   ')).toBe(false);
    expect(requests.length).toBe(0);
  });

  it('超长文本（>600）→ 拒绝并提示，不静默截断朗读', async () => {
    const ok = await tts.speakText('a'.repeat(601));
    expect(ok).toBe(false);
    expect(wxMock.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('太长') }));
    expect(requests.length).toBe(0);
  });
});
