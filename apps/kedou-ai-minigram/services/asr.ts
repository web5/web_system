/**
 * 语音识别（ASR）服务 — 按住说话、松手识别
 *
 * 链路：RecorderManager 录音（16k mp3）→ 本地文件转 base64
 *      → gateway `POST /api/ai/asr`（JSON，复用现成链路，不走请求体二进制透传）
 *      → ai-service `AsrService` → 腾讯云一句话识别 → 文本。
 *
 * 与朗读（services/tts）的协同：**开始录音前必须 stopSpeak()** ——
 * 否则麦克风会收进扬声器正在播的声音，识别结果全是胡话（回声自激）。
 *
 * 用法：
 *   await startAsr()                    // 按住
 *   const text = await stopAsr()        // 松手，返回识别文本（null = 取消/失败）
 *   cancelAsr()                         // 上滑取消
 *   onAsrState(cb) 订阅录音态（UI 据此渲染计时/波形/「识别中」）
 */
import { getApiBase } from './agent-stream';
import { getToken, isLoggedOut } from '../utils/request';
import { stopSpeak } from './tts';

const ASR_URL = '/api/ai/asr';

/** 单次录音上限（腾讯云一句话识别 ≤60s，与服务端口径一致） */
const MAX_SECONDS = 60;
/** 最短有效录音：低于此值视为误触 */
const MIN_DURATION_MS = 500;

export type AsrPhase = 'idle' | 'recording' | 'recognizing';

export interface AsrState {
  phase: AsrPhase;
  /** 已录音秒数（仅 recording 时有意义） */
  seconds: number;
}

type StateListener = (s: AsrState) => void;
const listeners = new Set<StateListener>();
let state: AsrState = { phase: 'idle', seconds: 0 };

function emit(next: AsrState): void {
  state = next;
  listeners.forEach((cb) => cb(state));
}

/** 当前状态（UI 初始化时用，避免首帧闪一下） */
export function getAsrState(): AsrState {
  return state;
}

/** 订阅状态变化；返回退订函数（页面 onUnload 调用） */
export function onAsrState(cb: StateListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

let recorder: WechatMiniprogram.RecorderManager | null = null;
let startedAt = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let cancelled = false;
/** 松手后在等识别结果的调用方（stopAsr 的 Promise） */
let pendingResolve: ((text: string | null) => void) | null = null;

function toast(title: string): void {
  wx.showToast({ title, icon: 'none', duration: 1500 });
}

/**
 * 隐私协议授权：麦克风属隐私接口，未同意时录音会静默失败（不报错也不出声）。
 * 老基础库没有这两个 API → 直接放行，由录音本身的错误回调兜底。
 */
function ensurePrivacy(): Promise<boolean> {
  return new Promise((resolve) => {
    const getSetting = (wx as any).getPrivacySetting;
    const requireAuth = (wx as any).requirePrivacyAuthorize;
    if (typeof getSetting !== 'function' || typeof requireAuth !== 'function') {
      resolve(true);
      return;
    }
    try {
      getSetting({
        success(res: any) {
          if (!res?.needAuthorization) {
            resolve(true);
            return;
          }
          requireAuth({
            success: () => resolve(true),
            fail: () => {
              toast('需要同意隐私协议才能使用语音');
              resolve(false);
            },
          });
        },
        fail: () => resolve(true), // 查不到就按「已授权」处理，交给录音结果兜底
      });
    } catch {
      resolve(true);
    }
  });
}

/** 录音权限（部分机型/系统需要显式授权） */
function ensureRecordAuth(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      wx.authorize({
        scope: 'scope.record',
        success: () => resolve(true),
        fail: () => {
          // authorize 失败不一定是真被拒（可能从未申请过）：打开设置页让用户自行开启
          wx.getSetting({
            success: (res) => {
              if (res.authSetting['scope.record'] === false) {
                wx.showModal({
                  title: '需要麦克风权限',
                  content: '语音输入需要麦克风，是否去设置开启？',
                  confirmText: '去设置',
                  success: (m) => {
                    if (m.confirm) wx.openSetting({});
                  },
                });
                resolve(false);
                return;
              }
              resolve(true); // 未申请过 → 交给录音结果兜底
            },
            fail: () => resolve(true),
          });
        },
      });
    } catch {
      resolve(true);
    }
  });
}

/** 取（并一次性绑定事件的）录音管理器 */
function ensureRecorder(): WechatMiniprogram.RecorderManager {
  if (!recorder) {
    recorder = wx.getRecorderManager();
    // ⚠️ 只绑一次：onStop/onError 重复注册会累积触发
    recorder.onStop((res) => {
      clearTick();
      if (cancelled) {
        finish(null);
        return;
      }
      const dur = Number(res?.duration || 0);
      if (dur < MIN_DURATION_MS) {
        toast('说话时间太短');
        finish(null);
        return;
      }
      emit({ phase: 'recognizing', seconds: Math.floor(dur / 1000) });
      void recognize(res.tempFilePath).then((text) => finish(text));
    });
    recorder.onError(() => {
      clearTick();
      toast('录音失败，请重试');
      finish(null);
    });
  }
  return recorder;
}

function clearTick(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/** 收尾：唤醒等待方 + 状态归位 */
function finish(text: string | null): void {
  emit({ phase: 'idle', seconds: 0 });
  const r = pendingResolve;
  pendingResolve = null;
  if (r) r(text);
}

/** 开始录音（按住说话） */
export async function startAsr(): Promise<boolean> {
  if (state.phase !== 'idle') return false;

  if (!getToken() || isLoggedOut()) {
    toast('请先登录');
    return false;
  }
  if (!(await ensurePrivacy())) return false;
  if (!(await ensureRecordAuth())) return false;

  // 打断朗读：避免扬声器声音被录进去
  stopSpeak();

  cancelled = false;
  startedAt = Date.now();
  emit({ phase: 'recording', seconds: 0 });

  tickTimer = setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    emit({ phase: 'recording', seconds: s });
    if (s >= MAX_SECONDS) void stopAsr(); // 到点自动结束并识别
  }, 250);

  try {
    ensureRecorder().start({
      duration: MAX_SECONDS * 1000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3',
    });
    return true;
  } catch {
    clearTick();
    emit({ phase: 'idle', seconds: 0 });
    toast('录音启动失败');
    return false;
  }
}

/** 松手：结束录音并识别，返回文本（null = 取消或失败，UI 不改动输入框） */
export function stopAsr(): Promise<string | null> {
  return new Promise((resolve) => {
    if (state.phase !== 'recording') {
      resolve(null);
      return;
    }
    pendingResolve = resolve;
    try {
      ensureRecorder().stop();
    } catch {
      clearTick();
      finish(null);
    }
  });
}

/** 取消本次录音（上滑取消 / 页面卸载） */
export function cancelAsr(): void {
  if (state.phase !== 'recording') return;
  cancelled = true;
  try {
    ensureRecorder().stop();
  } catch {
    clearTick();
    finish(null);
  }
}

/** 读取录音文件 → base64 → 调后端识别 */
function recognize(tempFilePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().readFile({
      filePath: tempFilePath,
      encoding: 'base64',
      success: (r) => {
        void postAsr(String(r.data || '')).then(resolve);
      },
      fail: () => {
        toast('读取录音失败');
        resolve(null);
      },
    });
  });
}

function postAsr(audioBase64: string): Promise<string | null> {
  const baseUrl = getApiBase();
  const token = getToken();
  if (!baseUrl || !audioBase64) {
    toast('语音识别不可用');
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    wx.request({
      url: `${baseUrl}${ASR_URL}`,
      method: 'POST',
      data: { audio: audioBase64, format: 'mp3' },
      timeout: 20000,
      header: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success(res) {
        const body = res.data as { text?: string; message?: string } | string;
        const status = res.statusCode;
        if (status === 200 && body && typeof body === 'object' && typeof body.text === 'string') {
          if (!body.text.trim()) {
            toast('没听清，请再说一次');
            resolve(null);
            return;
          }
          resolve(body.text);
          return;
        }
        // 503 = 服务端未配置 / 云上服务未开通：这类不是用户能重试解决的
        if (status === 503) {
          toast('语音识别服务未开通');
          resolve(null);
          return;
        }
        const msg = (body as { message?: string })?.message || '';
        toast(msg || '识别失败，请重试');
        resolve(null);
      },
      fail() {
        toast('网络异常，识别失败');
        resolve(null);
      },
    });
  });
}
