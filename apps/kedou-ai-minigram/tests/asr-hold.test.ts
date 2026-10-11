/// <reference types="node" />
/// <reference types="jest" />
// tests/asr-hold.test.ts
// 「按住说话」生命周期 TDD —— 防回归用。
//
// 事故原型（2026-10-11 真机）：授权是异步的（首次还会弹系统授权框），旧实现在 await
// 期间状态仍是 idle，于是「点一下」松手后 touchend 判定「不在录音中」直接 return，
// 等授权回来录音才启动且无人收尾 → 浮层一直挂着，长按语义被架空。
//
// 本文件锁死三条不变量：
//   ① 按下即入 preparing（同步，不等 await）
//   ② preparing 期间松手 / 被系统打断 → 不开麦、不残留录音态
//   ③ 按住到授权完成再松手 → 正常开麦并识别

jest.mock('../services/agent-stream', () => ({ getApiBase: () => 'https://dev.kedouai.com' }));
jest.mock('../utils/request', () => ({ getToken: () => 'tk', isLoggedOut: () => false }));
jest.mock('../services/tts', () => ({ stopSpeak: jest.fn() }));

type StopCb = (res: { duration: number; tempFilePath: string }) => void;

interface RecorderMock {
  start: jest.Mock;
  stop: jest.Mock;
  onStop: (cb: StopCb) => void;
  onError: (cb: () => void) => void;
}

let recorder: RecorderMock;
let stopCb: StopCb | null = null;
/** 授权回调延迟（ms）：0 = 已授权过，50 = 首次弹系统授权框的耗时量级 */
let authorizeDelay = 0;
let recognizedText = '你好，帮我写周报';

function installWx(): void {
  recorder = {
    start: jest.fn(),
    stop: jest.fn(),
    onStop: (cb) => {
      stopCb = cb;
    },
    onError: jest.fn(),
  };
  (global as any).wx = {
    getRecorderManager: () => recorder,
    authorize: jest.fn((o: any) => {
      if (authorizeDelay > 0) setTimeout(() => o.success(), authorizeDelay);
      else o.success();
    }),
    getSetting: jest.fn((o: any) => o.success({ authSetting: {} })),
    showToast: jest.fn(),
    getFileSystemManager: () => ({ readFile: (o: any) => o.success({ data: 'BASE64' }) }),
    request: jest.fn((o: any) => o.success({ statusCode: 200, data: { text: recognizedText } })),
    // 刻意不提供 getPrivacySetting / requirePrivacyAuthorize：
    // 老基础库分支 → ensurePrivacy 按「已授权」放行，本文件只测录音生命周期
  };
}

/** 每次用干净模块：asr 内部有 privacyOk / authOk 会话级缓存 */
function loadAsr(): any {
  let m: any;
  jest.isolateModules(() => {
    m = require('../services/asr');
  });
  return m;
}

describe('按住说话生命周期（services/asr）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    authorizeDelay = 0;
    stopCb = null;
    recognizedText = '你好，帮我写周报';
    installWx();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (global as any).wx;
    jest.clearAllMocks();
  });

  it('按下即同步进入 preparing（授权还没回来也要有状态）', async () => {
    authorizeDelay = 50;
    const asr = loadAsr();
    const p = asr.startAsr();
    expect(asr.getAsrState().phase).toBe('preparing');
    await asr.releaseAsr();
    await jest.advanceTimersByTimeAsync(200);
    await p;
  });

  it('授权未回来就松手 → 不开麦、状态归位（点一下不该弹出录音浮层）', async () => {
    authorizeDelay = 50;
    const asr = loadAsr();
    const p = asr.startAsr();
    await expect(asr.releaseAsr()).resolves.toBeNull();
    await jest.advanceTimersByTimeAsync(200);
    await p;
    expect(recorder.start).not.toHaveBeenCalled();
    expect(asr.getAsrState().phase).toBe('idle');
  });

  it('preparing 期间被系统打断（touchcancel / 页面卸载）→ 同样不开麦', async () => {
    authorizeDelay = 50;
    const asr = loadAsr();
    const p = asr.startAsr();
    asr.cancelAsr();
    await jest.advanceTimersByTimeAsync(200);
    await p;
    expect(recorder.start).not.toHaveBeenCalled();
    expect(asr.getAsrState().phase).toBe('idle');
  });

  it('按住到授权完成再松手 → 开麦并识别，结果回填输入框', async () => {
    authorizeDelay = 0;
    const asr = loadAsr();
    await expect(asr.startAsr()).resolves.toBe(true);
    expect(asr.getAsrState().phase).toBe('recording');
    expect(recorder.start).toHaveBeenCalledTimes(1);

    const p = asr.releaseAsr();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    stopCb?.({ duration: 1200, tempFilePath: '/tmp/a.mp3' });
    await expect(p).resolves.toBe('你好，帮我写周报');
    expect(asr.getAsrState().phase).toBe('idle');
  });

  it('录音太短（<500ms）→ 不回填，提示改为「按住」语义', async () => {
    authorizeDelay = 0;
    const asr = loadAsr();
    await asr.startAsr();
    const p = asr.releaseAsr();
    stopCb?.({ duration: 120, tempFilePath: '/tmp/a.mp3' });
    await expect(p).resolves.toBeNull();
    expect((global as any).wx.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '按住麦克风说话，松手识别' }),
    );
  });

  it('onStop 迟迟不回 → 4s 看门狗强制收尾（不变量 4：浮层必归 idle）', async () => {
    authorizeDelay = 0;
    const asr = loadAsr();
    await asr.startAsr();
    const p = asr.releaseAsr();
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    // 刻意不触发 stopCb：模拟真机 onStop 丢失
    await jest.advanceTimersByTimeAsync(4000);
    await expect(p).resolves.toBeNull();
    expect(asr.getAsrState().phase).toBe('idle');
    expect((global as any).wx.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: '没收到录音结果，请再试一次' }),
    );
  });
});
