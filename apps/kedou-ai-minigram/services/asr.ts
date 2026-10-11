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
 *   await startAsr()                    // 按住（内部有异步授权，故返回 Promise）
 *   const text = await releaseAsr()     // 松手，返回识别文本（null = 取消/失败）
 *   cancelAsr()                         // 上滑取消
 *   onAsrState(cb) 订阅录音态（UI 据此渲染计时/波形/「识别中」）
 *
 * ⚠️ 2026-10-11 修复「点一下也弹录音浮层」：
 *   startAsr 里的隐私协议 + 录音授权是**异步**的（首次还会弹系统授权框，耗时 1s 级）。
 *   旧实现在这段 await 期间状态仍是 idle，于是手指已松开、touchend 判定「不在录音中」
 *   直接 return；等授权回来录音才真正启动 —— 没人再给它 stop，浮层就一直挂着（直到
 *   60s 上限）。表现为「点一下 = 弹出录音浮层停不下来」，长按语义被架空。
 *   修法：按下即同步进入 `preparing` 态，松手（releaseAsr）时若仍在 preparing
 *   → 标记放弃，授权回来后不再启动录音。手指离开 = 结束，才是长按该有的语义。
 */
import { getApiBase } from './agent-stream';
import { getToken, isLoggedOut } from '../utils/request';
import { stopSpeak } from './tts';

const ASR_URL = '/api/ai/asr';

/** 单次录音上限（腾讯云一句话识别 ≤60s，与服务端口径一致） */
const MAX_SECONDS = 60;
/** 最短有效录音：低于此值视为误触 */
const MIN_DURATION_MS = 500;

/**
 * 录音生命周期。
 * - `preparing`：手指已按下，正在走隐私协议 / 录音授权，**尚未**开麦（首次授权耗时 1s 级）
 * - `recording`：已开麦，计时中
 * - `recognizing`：已松手，等云端结果
 * UI 浮层对 preparing / recording / recognizing 都要可见（否则用户以为按下没反应）。
 */
export type AsrPhase = 'idle' | 'preparing' | 'recording' | 'recognizing';

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
/** 松手后在等识别结果的调用方（releaseAsr / stopAsr 的 Promise） */
let pendingResolve: ((text: string | null) => void) | null = null;

/** 手指是否仍按在麦克风上（同步维护，不等 await） */
let pressed = false;
/** 授权/启动进行中：此时尚未开麦，松手即放弃 */
let preparing = false;
/** 授权途中已松手 → 授权回来后不启动录音 */
let releaseEarly = false;
/** 授权结果缓存：同一会话只问一次，避免每次按下都被 await 卡住（这是「点一下像没反应」的次因） */
let privacyOk = false;
let authOk = false;

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
      clearStopWatchdog();
      if (cancelled) {
        finish(null);
        return;
      }
      const dur = Number(res?.duration || 0);
      if (dur < MIN_DURATION_MS) {
        // 低于阈值基本是「点了一下」：明确告知是按住，而不是含糊说太短
        toast('按住麦克风说话，松手识别');
        finish(null);
        return;
      }
      emit({ phase: 'recognizing', seconds: Math.floor(dur / 1000) });
      void recognize(res.tempFilePath).then((text) => finish(text));
    });
    recorder.onError(() => {
      clearTick();
      clearStopWatchdog();
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
  preparing = false;
  pressed = false;
  clearStopWatchdog();
  emit({ phase: 'idle', seconds: 0 });
  const r = pendingResolve;
  pendingResolve = null;
  if (r) r(text);
}

/**
 * stop() 后等待 onStop 的看门狗（规格 §8 修订 ③ · 不变量 4）。
 * 真机偶发 onStop 不回（尤其长录音后）：不兜底 = 浮层悬挂到天荒地老。
 * 4s 足够宽裕 —— onStop 正常 <1s；识别阶段的耗时由 request timeout 兜，不归它管。
 */
let stopWatchdog: ReturnType<typeof setTimeout> | null = null;

function armStopWatchdog(): void {
  clearStopWatchdog();
  stopWatchdog = setTimeout(() => {
    stopWatchdog = null;
    if (pendingResolve) {
      toast('没收到录音结果，请再试一次');
      finish(null);
    }
  }, 4000);
}

function clearStopWatchdog(): void {
  if (stopWatchdog) {
    clearTimeout(stopWatchdog);
    stopWatchdog = null;
  }
}

/** 收尾并归位（不唤醒等待方：用于「未真正开麦」的放弃路径） */
function resetToIdle(): void {
  preparing = false;
  pressed = false;
  emit({ phase: 'idle', seconds: 0 });
}

/**
 * 隐私协议 + 录音授权（结果按会话缓存，二次按下不再 await）。
 * 首次仍会弹系统授权框：那 1s 左右用户手指大概率已松 —— 由 preparing 态兜住。
 */
async function ensureReady(): Promise<boolean> {
  if (!privacyOk) {
    if (!(await ensurePrivacy())) return false;
    privacyOk = true;
  }
  if (!authOk) {
    if (!(await ensureRecordAuth())) return false;
    authOk = true;
  }
  return true;
}

/** 开始录音（按住说话） */
export async function startAsr(): Promise<boolean> {
  // preparing 也算「忙」：连点两次会开两次麦，第二次必须挡掉
  if (state.phase !== 'idle' || preparing) return false;

  if (!getToken() || isLoggedOut()) {
    toast('请先登录');
    return false;
  }

  // 按下即同步入态：让 UI 立刻有反馈，也让 touchend 能识别「按下过但还没开麦」
  pressed = true;
  releaseEarly = false;
  preparing = true;
  emit({ phase: 'preparing', seconds: 0 });

  const ready = await ensureReady();
  if (!ready || !pressed || releaseEarly) {
    // 手指已离开 / 授权被拒 → 长按语义下本次作废，绝不在松手后才开麦
    if (releaseEarly) toast('按住麦克风说话，松手识别');
    resetToIdle();
    return false;
  }

  // 打断朗读：避免扬声器声音被录进去
  stopSpeak();

  cancelled = false;
  startedAt = Date.now();
  emit({ phase: 'recording', seconds: 0 });

  tickTimer = setInterval(() => {
    // 收尾保护：finish 后可能残留一次 tick（clearInterval 与已排队的回调有竞态），
    // 不拦会把 idle 覆盖回 recording，浮层文案/计时全部错乱（不变量 4）
    if (state.phase !== 'recording') {
      clearTick();
      return;
    }
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
    preparing = false;
    return true;
  } catch {
    clearTick();
    resetToIdle();
    toast('录音启动失败');
    return false;
  }
}

/**
 * 松手：结束录音并识别，返回文本（null = 取消或失败，UI 不改动输入框）。
 *
 * 关键：preparing 期间松手也算一次「松开」—— 标记放弃，等授权回来不再开麦，
 * 而不是像旧实现那样留一个没人收尾的录音在跑。
 */
export function releaseAsr(): Promise<string | null> {
  return new Promise((resolve) => {
    pressed = false;
    if (state.phase === 'preparing') {
      releaseEarly = true;
      resetToIdle();
      resolve(null);
      return;
    }
    if (state.phase !== 'recording') {
      resolve(null);
      return;
    }
    pendingResolve = resolve;
    try {
      ensureRecorder().stop();
      armStopWatchdog();
    } catch {
      clearTick();
      finish(null);
    }
  });
}

/** 到点（60s 上限）自动结束并识别：非用户松手路径，故不带 preparing 判定 */
export function stopAsr(): Promise<string | null> {
  pressed = false;
  return new Promise((resolve) => {
    if (state.phase !== 'recording') {
      resolve(null);
      return;
    }
    pendingResolve = resolve;
    try {
      ensureRecorder().stop();
      armStopWatchdog();
    } catch {
      clearTick();
      finish(null);
    }
  });
}

/** 取消本次录音（上滑取消 / 页面卸载 / 系统打断） */
export function cancelAsr(): void {
  pressed = false;
  if (state.phase === 'preparing') {
    releaseEarly = true;
    resetToIdle();
    return;
  }
  if (state.phase !== 'recording') return;
  cancelled = true;
  try {
    ensureRecorder().stop();
    armStopWatchdog();
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
