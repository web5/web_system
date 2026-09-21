/**
 * 朗读（TTS）服务 — 复用后端已有能力，分句流式播放
 *
 * 链路：小程序 → gateway `POST /api/ai/tts/speak`（原生 http 转发，二进制原样透传）
 *       → ai-service `TtsService`（腾讯云 TTS，英文发音人）→ mp3 二进制。
 *
 * 流式体验（用户不等待整段合成）：
 *   文本按句切块（utils/translate-parse 的 splitSpeakChunks）→ 首块合成完立即开播，
 *   其余块在上一块播放期间后台预取 —— 等待时间 ≈ 首句合成（约 1s），
 *   `speakText` 在首块开播后即返回（不等整段）。
 *
 * 反馈形态（不弹全屏 loading）：合成中 / 播放中通过 `onSpeakState` 推送，
 * 调用方渲染按钮内联态（「请稍候…」「停止」）。
 *
 * 缓存：音频按「块文本 hash」落盘（USER_DATA_PATH），同一段文本第二次点直接秒播。
 *
 * 用法：speakText(text) —— 同一段文本再调一次 = 停止；页面卸载调 stopSpeak()。
 */
import { getApiBase } from './agent-stream';
import { getToken } from '../utils/request';
import { splitSpeakChunks } from '../utils/translate-parse';

const TTS_URL = '/api/ai/tts/speak';

/** 整段朗读的文本上限（分块后每块 ≤110；总量限幅控制合成耗时与流量） */
const MAX_TEXT_LEN = 600;

/** 磁盘缓存上限：超过则淘汰最旧（单条 mp3 约几 KB~几十 KB，30 条远够复用） */
const MAX_CACHE_FILES = 30;

/** 播放流水线序号：stopSpeak 自增 → 在途流水线全部作废 */
let runSeq = 0;
/** 正在播放的实例（全局单例：新的朗读会顶掉上一个） */
let audio: WechatMiniprogram.InnerAudioContext | null = null;
/** 当前朗读的整段文本（用于「再点一次 = 停」） */
let playingText = '';
/** 正在合成 / 播放的状态（null = 空闲） */
let speakState: SpeakState | null = null;
/** 播放中的等待者（stopSpeak 时统一唤醒，避免 destroy 后回调不触发卡死流水线） */
const activeWaiters = new Set<() => void>();

/** 朗读状态（页面据此渲染按钮内联态） */
export interface SpeakState {
  text: string;
  phase: 'loading' | 'playing';
}

type SpeakStateListener = (s: SpeakState | null) => void;
const listeners = new Set<SpeakStateListener>();

/** 订阅朗读状态变化；返回退订函数（页面 onUnload 时调用） */
export function onSpeakState(cb: SpeakStateListener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emitState(next: SpeakState | null): void {
  speakState = next;
  listeners.forEach((cb) => cb(next));
}

/** 停止播放：作废在途流水线、唤醒等待者、释放播放实例、状态置回空闲 */
export function stopSpeak(): void {
  runSeq += 1;
  activeWaiters.forEach((wake) => wake());
  activeWaiters.clear();
  if (audio) {
    try {
      audio.stop();
      audio.destroy();
    } catch {
      /* 已销毁 / 未初始化：忽略 */
    }
    audio = null;
  }
  playingText = '';
  if (speakState) emitState(null);
}

/**
 * 朗读一段文本（分句流式：首块开播即返回，整段在后台流水线里继续）。
 * @returns true 已开始播放；false 未播放（空文本、超长、或本次是「停止」操作）。
 * 播放结束 / 中断 / 失败通过 onSpeakState 推 null 通知页面复位按钮。
 */
export async function speakText(text: string): Promise<boolean> {
  const t = String(text || '').trim();
  if (!t) return false;
  // 同一段正在播 → 停止（不做重复合成）
  if (playingText === t) {
    stopSpeak();
    return false;
  }
  if (t.length > MAX_TEXT_LEN) {
    wx.showToast({ title: '文本太长，暂不支持朗读', icon: 'none' });
    return false;
  }

  stopSpeak();

  const chunks = splitSpeakChunks(t);
  if (!chunks.length) return false;

  const myRun = runSeq;
  playingText = t;
  emitState({ text: t, phase: 'loading' });

  // 只等首块（缓存命中则瞬间）：成功开播后立即返回，余下交给后台流水线。
  // ⚠️ 不能等整段播完再返回 —— 页面 await 后会重设播放态，把「播完置闲」的回调覆盖掉。
  const firstPath = await ensureAudioFile(chunks[0]);
  if (runSeq !== myRun) return true; // 等待期间被停止 / 被新朗读顶掉
  if (!firstPath) {
    playingText = '';
    emitState(null);
    wx.showToast({ title: '朗读失败，请重试', icon: 'none' });
    return false;
  }
  emitState({ text: t, phase: 'playing' });
  void playThrough(chunks, firstPath, myRun);
  return true;
}

/**
 * 后台播放流水线：从首块起逐块播放，并在播放期间预取下一块。
 * 中途被停止（runSeq 变化）静默退出；自然结束 / 出错收尾时复位状态。
 */
async function playThrough(
  chunks: string[],
  firstPath: string,
  myRun: number,
): Promise<void> {
  let filePath: string | null = firstPath;
  let next: Promise<string | null> | null = null;

  for (let i = 0; i < chunks.length; i++) {
    if (runSeq !== myRun) return;
    if (filePath === null) {
      // 首块由调用方处理过；这里必然是中途块失败（已在播，标中断即可）
      wx.showToast({ title: '朗读已中断', icon: 'none' });
      break;
    }
    // 预取下一块（不 await：与本块播放并行）
    if (i + 1 < chunks.length) {
      next = ensureAudioFile(chunks[i + 1]).catch(() => null);
    }

    const result = await playFileAndWait(filePath);
    if (runSeq !== myRun || result === 'stopped') return;
    if (result === 'error') {
      wx.showToast({ title: '播放失败', icon: 'none' });
      break;
    }

    // 接预取好的下一块
    if (next) {
      filePath = await next;
      next = null;
    }
  }

  // 收尾：自然播完（或中断/出错）→ 复位播放态，页面按钮恢复「朗读」
  if (runSeq === myRun) {
    playingText = '';
    if (audio) {
      try {
        audio.destroy();
      } catch {
        /* 忽略 */
      }
      audio = null;
    }
    emitState(null);
  }
}

/** 播放一个音频文件，结束 / 出错 / 被停止时 resolve */
function playFileAndWait(filePath: string): Promise<'ended' | 'error' | 'stopped'> {
  return new Promise((resolve) => {
    const ctx = wx.createInnerAudioContext();
    audio = ctx;
    // 停止唤醒：stopSpeak destroy 实例后 onEnded/onStop 不一定触发，靠 waiter 兜底
    const wake = () => {
      activeWaiters.delete(wake);
      resolve('stopped');
    };
    activeWaiters.add(wake);
    const settle = (r: 'ended' | 'error') => {
      activeWaiters.delete(wake);
      resolve(r);
    };
    ctx.src = filePath;
    ctx.onEnded(() => settle('ended'));
    ctx.onError(() => settle('error'));
    ctx.play();
  });
}

/** 取一块音频的本地文件：缓存命中直接返回，否则请求后端并落盘 */
async function ensureAudioFile(chunk: string): Promise<string | null> {
  let filePath = cachePath(chunk);
  if (fileExists(filePath)) return filePath;

  let buf: ArrayBuffer;
  try {
    buf = await requestTtsAudio(chunk);
  } catch {
    return null;
  }
  try {
    await writeAudioFile(filePath, buf);
    trimCache();
    return filePath;
  } catch {
    // 落盘失败不阻断播放：退回一次性临时文件
    const tmp = `${wx.env.USER_DATA_PATH}/tts_tmp_${Date.now()}.mp3`;
    try {
      await writeAudioFile(tmp, buf);
      return tmp;
    } catch {
      return null;
    }
  }
}

/** 请求 TTS 二进制音频 */
function requestTtsAudio(text: string): Promise<ArrayBuffer> {
  const baseUrl = getApiBase();
  const token = getToken();
  if (!baseUrl) return Promise.reject(new Error('应用未初始化，请稍后重试'));

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${TTS_URL}`,
      method: 'POST',
      data: { text },
      // 音频是二进制：必须声明 arraybuffer，否则 res.data 会被当文本解析
      responseType: 'arraybuffer',
      timeout: 15000,
      header: {
        'Content-Type': 'application/json',
        // 与 utils/request 一致：开发者工具对 gzip 响应解析失败，强制明文
        'Accept-Encoding': 'identity',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success(res) {
        // ⚠️ gateway 的错误响应也是 HTTP 200（如 code 4010「Authorization header missing」），
        // 只认状态码会把 JSON 错误体当 mp3 去播 —— 这里按「响应体是不是音频」判定。
        if (res.statusCode === 200 && !isJsonResponse(res)) {
          resolve(res.data as ArrayBuffer);
          return;
        }
        reject(new Error(ttsErrorMessage(res.statusCode, res.data)));
      },
      fail() {
        reject(new Error('网络请求失败'));
      },
    });
  });
}

/**
 * 判定响应体是不是 JSON 错误体（而不是音频）。
 * 先看 Content-Type，再看首字节（mp3 以 ID3 或 0xFF 开头，JSON 以 { 或 [ 开头）。
 */
function isJsonResponse(res: WechatMiniprogram.RequestSuccessCallbackResult): boolean {
  const header = (res.header || {}) as Record<string, any>;
  const ct = String(header['Content-Type'] || header['content-type'] || '');
  if (ct.indexOf('application/json') >= 0) return true;

  const data = res.data;
  if (typeof data === 'string') return /^\s*[{[]/.test(data);
  if (data instanceof ArrayBuffer) {
    const head = new Uint8Array(data.slice(0, 1));
    if (!head.length) return false;
    const c = String.fromCharCode(head[0]);
    return c === '{' || c === '[';
  }
  return false;
}

function ttsErrorMessage(status: number, data: any): string {
  const fromBody = tryReadMessage(data);
  // 鉴权类错误技术原文不直接透给用户
  if (fromBody && /Authorization|token|登录|未授权/i.test(fromBody)) return '登录已过期，请重试';
  // 云厂商侧错误（密钥无效 / 欠费 / 限流等）：技术原文不透传
  if (fromBody && /SecretId|SecretKey|Credential|AuthFailure|InvalidAccess|LimitExceeded|FailedOperation/i.test(fromBody)) {
    return '朗读服务暂不可用，请稍后再试';
  }
  if (fromBody) return fromBody;
  if (status === 401) return '登录已过期，请重试';
  if (status === 503) return '朗读未配置';
  return `朗读失败 (${status})`;
}

/** 错误响应体（ArrayBuffer 形式的 JSON）→ message；解析不出返回空串 */
function tryReadMessage(data: any): string {
  try {
    if (typeof data === 'string') return JSON.parse(data)?.message || '';
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      try {
        s = decodeURIComponent(escape(s));
      } catch {
        /* 不是合法 UTF-8 序列：按原样解析 */
      }
      return JSON.parse(s)?.message || '';
    }
  } catch {
    /* 非 JSON（例如截断的音频流）：交给状态码兜底 */
  }
  return '';
}

/** 写入音频文件（InnerAudioContext 只认本地路径，不认 Buffer） */
function writeAudioFile(filePath: string, data: ArrayBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data,
      encoding: 'binary',
      success: () => resolve(),
      fail: (err) => reject(new Error(err?.errMsg || '音频写入失败')),
    });
  });
}

/** 块文本 → 稳定缓存文件名（hash + 长度，规避低概率碰撞） */
function cachePath(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return `${wx.env.USER_DATA_PATH}/tts_${(h >>> 0).toString(36)}_${text.length}.mp3`;
}

/** 文件是否已存在（缓存命中判定） */
function fileExists(path: string): boolean {
  try {
    wx.getFileSystemManager().accessSync(path);
    return true;
  } catch {
    return false;
  }
}

/** 缓存淘汰：超过上限删最旧的（失败静默，不影响播放） */
function trimCache(): void {
  try {
    const fsm = wx.getFileSystemManager();
    const dir = wx.env.USER_DATA_PATH;
    const files = fsm.readdirSync(dir).filter((f) => f.indexOf('tts_') === 0);
    if (files.length <= MAX_CACHE_FILES) return;
    const statted = files
      .map((f) => {
        const p = `${dir}/${f}`;
        try {
          return { p, mtime: fsm.statSync(p).mtimeMs || 0 };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{ p: string; mtime: number }>;
    statted.sort((a, b) => a.mtime - b.mtime);
    const excess = statted.slice(0, statted.length - MAX_CACHE_FILES);
    for (const { p } of excess) {
      try {
        fsm.unlinkSync(p);
      } catch {
        /* 删不掉就算了 */
      }
    }
  } catch {
    /* 目录读不出：跳过淘汰 */
  }
}
