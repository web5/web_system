/**
 * 朗读（TTS）—— PC 端走后端腾讯云 TTS（统一音色），替代浏览器 Web Speech。
 *
 * 链路：portal → gateway `POST /api/ai/tts/speak`（原生 http 二进制透传）
 *       → ai-service `TtsService`（腾讯云 TTS，音色 603007 邻家女孩，中英混读）→ mp3 二进制。
 *
 * 与小程序 `services/tts.ts` 同一条后端链路；PC 端用 `Audio` 对象播放（小程序用 InnerAudioContext）。
 *
 * 切块策略（specs/tts-continuity/design.md）：**首句 1 块 + 剩余整段 1 块**。
 * 腾讯云单次上限实测为「英文 ≥499 / 中文 ≥150」，所以剩余整段绝大多数由服务端一次合成
 * （语调连贯）；只有极长文本才由服务端按句切片并发拼接。块数从「按 110 切碎」的 5 块降到 2 块，
 * 唯一接缝落在句末标点处。
 */
import { ref } from 'vue';
import { message } from 'ant-design-vue';
import request from '@/api/request';
import { getStoredToken } from '@/stores/user';
import { API_TIMEOUT } from '@web-system/shared';

/**
 * 朗读不可用提示（**C 端话术**，不暴露「服务端 TTS 凭据缺失」内部细节）。
 * 内部原因留给 `/ai/tts/health` 与 `docs/operations/tts-credentials-runbook.md`。
 */
export const TTS_OFF_TIP = '朗读服务暂不可用，请稍后再试';

/**
 * 朗读能力是否不可用（服务端 `GET /ai/tts/health` → `configured === false`）。
 *
 * 2026-10-09 事故（rNPjtC）：dev/prod 缺 `TENCENT_*` 凭据数月，用户侧唯一信号是
 * 「点一下弹请求失败」。本开关把「不可用」前移到点击之前。
 */
export const ttsUnavailable = ref(false);

let ttsHealthFetched = false;

/**
 * 进页时拉一次朗读能力健康状态（结果进 `ttsUnavailable`）。
 *
 * - 拉取**中**：按「可用」渲染 —— 避免禁用态闪烁与误伤
 * - 拉取**失败**：也按「可用」渲染 —— 健康检查自身故障不该误禁用，仍走点击后报错路径
 * - 只拉一次（模块级标记），不每次点击都打 health
 */
export async function refreshTtsHealth(): Promise<void> {
  if (ttsHealthFetched) return;
  ttsHealthFetched = true;
  try {
    const data = (await request.get('/ai/tts/health', {
      silent: true,
      timeout: API_TIMEOUT.DEFAULT,
    })) as { configured?: boolean; streamConfigured?: boolean } | null;
    // 只认显式 false：字段缺失/格式异常一律当可用，避免误禁用
    ttsUnavailable.value = data?.configured === false;
  } catch {
    ttsUnavailable.value = false;
  }
}

/** 流式合成的采样率（与服务端 SampleRate=16000 对齐） */
const STREAM_SAMPLE_RATE = 16000;

/**
 * 朗读失败。
 *
 * `permanent = true` 表示**永久性错误**（凭据未配置 / 参数错误）——回退整段链路只会
 * 重复失败并重复弹错（2026-10-09 事故：1 次失败 → 3 次请求 → 3 个 toast）。
 */
export class TtsError extends Error {
  readonly permanent: boolean;
  readonly status?: number;

  constructor(msg: string, opts: { permanent?: boolean; status?: number } = {}) {
    super(msg);
    this.name = 'TtsError';
    this.permanent = opts.permanent ?? false;
    this.status = opts.status;
  }
}

/**
 * 判定是否永久性错误：4xx（除 408/429 这类可重试的）与服务端明示的「未配置」类错误
 * 重试/回退没有意义，应当直接把真实原因告知用户。
 */
function isPermanentFailure(status: number, msg: string): boolean {
  if (msg.includes('未配置')) return true;
  if (status >= 400 && status < 500) return status !== 408 && status !== 429;
  return false;
}

/** 首句单块上限：控制首播等待 ≈ 首句合成时间（实测 110 字符约 2s） */
const MAX_FIRST_CHUNK = 110;

/** 句末标点（中英） */
const SENTENCE_END = '.!?;。！？；…';

/**
 * 文本 → 朗读块序列：**首句单独成块**（首播快），其余整段作为一块交给服务端。
 * @returns [首句] 或 [首句, 剩余整段]
 */
export function splitSpeakParts(text: string, max = MAX_FIRST_CHUNK): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];

  // 首句：句末标点处断；单句超上限则在空格处截（不切碎单词，只影响首播那一块）
  let cut = -1;
  for (let i = 0; i < t.length; i++) {
    if (SENTENCE_END.indexOf(t[i]) >= 0) {
      cut = i + 1;
      break;
    }
  }
  let first = cut > 0 ? t.slice(0, cut).trim() : t;
  if (first.length > max) {
    const spaceCut = first.lastIndexOf(' ', max);
    first = first.slice(0, spaceCut > max * 0.5 ? spaceCut : max).trim();
  }
  const rest = t.slice(first.length).trim();
  return rest ? [first, rest] : [first];
}

/**
 * 请求一段文本的 TTS 音频（mp3 Blob）；失败抛 TtsError（带服务端真实原因）。
 *
 * `silent: true` —— 关掉 axios 全局 toast：一次朗读会并发发起 N 个分块请求，
 * 全局拦截器会弹 N 个「请求失败」。这里改由 `speak()` 统一弹一次真实原因。
 */
export async function requestTts(text: string): Promise<Blob> {
  try {
    // 单片合成实测 2~6s，超过 DEFAULT(10s)：必须单独放宽超时
    const data = (await request.post(
      '/ai/tts/speak',
      { text },
      { responseType: 'blob', timeout: API_TIMEOUT.TTS, silent: true },
    )) as unknown as Blob;
    return data;
  } catch (err: any) {
    const status: number | undefined = err?.response?.status;
    const msg: string = err?.response?.data?.message || err?.message || '语音合成失败';
    throw new TtsError(msg, { permanent: isPermanentFailure(status ?? 0, msg), status });
  }
}

/** 全局音频播放器（整段播放用；单例：新的播放顶掉旧的，与小程序 services/tts.ts 同一语义） */
let currentAudio: HTMLAudioElement | null = null;

/** 流式播放用 WebAudio 上下文；nextStartTime 保证分片间精确到采样点衔接 */
let audioCtx: AudioContext | null = null;
let activeSources: AudioBufferSourceNode[] = [];
let nextStartTime = 0;
/** 流式请求的中断器 */
let streamAbort: AbortController | null = null;

/** 停止播放：中断整段播放与流式播放，并复位 */
export function stopTts(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (streamAbort) {
    streamAbort.abort();
    streamAbort = null;
  }
  activeSources.forEach((s) => {
    try {
      s.stop();
    } catch {
      /* 已结束：忽略 */
    }
  });
  activeSources = [];
  if (audioCtx && audioCtx.state !== 'closed') {
    void audioCtx.close().catch(() => undefined);
    audioCtx = null;
  }
  nextStartTime = 0;
}

/** 播放 mp3 Blob；结束 / 出错 / 被 stopTts 替换时 resolve */
export function playTtsBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    const done = () => {
      if (currentAudio === audio) currentAudio = null;
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

/**
 * 按块顺序朗读：首块合成完即开播，后续块在上一块播放期间预取（消除块间空档）。
 * @param chunks splitSpeakParts 的产物
 * @param isActive 是否仍由本次朗读占用（被停止 / 被新朗读顶掉时返回 false）
 * @param onPhase 开播时回调（页面据此把「请稍候…」切成「停止」）
 */
export async function speakSequence(
  chunks: string[],
  opts: { isActive: () => boolean; onPhase?: (phase: 'loading' | 'playing') => void },
): Promise<void> {
  // 所有块并发发起：剩余块的合成与首块同时进行，首块播完时剩余已就绪 —— 消除块间空档。
  // （串行发请求的等待 = 剩余块合成时间 − 首块音频时长，实测会差出 0~3s 的静音。）
  // 保留原始错误（而不是吞成 null）：首块失败时要把服务端的真实原因抛给上层
  const pending = chunks.map((c): Promise<Blob | Error> =>
    requestTts(c).catch((e: unknown) => (e instanceof Error ? e : new TtsError(String(e)))),
  );

  const first = await pending[0];
  if (!opts.isActive()) return;
  if (first instanceof Error) throw first;
  opts.onPhase?.('playing');

  let blob: Blob = first;
  for (let i = 0; i < chunks.length; i++) {
    await playTtsBlob(blob);
    if (!opts.isActive()) return;
    if (i + 1 >= chunks.length) return;

    const next = await pending[i + 1];
    if (next instanceof Error) throw next;
    blob = next;
  }
}

/**
 * 流式朗读（P1）：服务端一次连续合成并分块下发，端侧边收边播。
 *
 * 与整段方案的本质差别：整段方案是「多个独立合成的文件排队播」，块间必然有
 * 语调重置 + mp3 padding + 播放器切换；流式是同一条连续音频流，端侧按采样点
 * 精确衔接（nextStartTime），因此没有接缝。实测首包约 0.6s 出声。
 *
 * 音频为 pcm（16bit / 16kHz / 单声道），端侧零解码直接播。
 */
export async function streamSpeak(
  text: string,
  opts: { isActive: () => boolean; onPhase?: (phase: 'loading' | 'playing') => void },
): Promise<void> {
  const token = getStoredToken();
  const abort = new AbortController();
  streamAbort = abort;

  const res = await fetch(
    `/api/ai/tts/stream?text=${encodeURIComponent(text)}&codec=pcm`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: abort.signal },
  );
  if (!opts.isActive()) return;
  if (!res.ok || !res.body) {
    // 读出错误体：流式端点直接 res.json({code,message})，真实原因不能丢
    const raw = await res.text().catch(() => '');
    let msg = `流式朗读失败 (${res.status})`;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.message) msg = String(parsed.message);
    } catch {
      if (raw) msg = raw.slice(0, 120);
    }
    throw new TtsError(msg, { permanent: isPermanentFailure(res.status, msg), status: res.status });
  }

  const ctx = ensureAudioCtx();
  if (ctx.state === 'suspended') await ctx.resume();

  const reader = res.body.getReader();
  let carry: Uint8Array | null = null; // pcm 为 2 字节对齐，跨分片的单字节先攒着
  let started = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!opts.isActive()) {
      await reader.cancel().catch(() => undefined);
      return;
    }

    let bytes: Uint8Array = value;
    if (carry) {
      const merged = new Uint8Array(carry.length + bytes.length);
      merged.set(carry);
      merged.set(bytes, carry.length);
      bytes = merged;
      carry = null;
    }
    const odd = bytes.length % 2;
    if (odd) {
      carry = bytes.subarray(bytes.length - odd);
      bytes = bytes.subarray(0, bytes.length - odd);
    }
    if (!bytes.length) continue;

    if (!started) {
      started = true;
      opts.onPhase?.('playing');
    }
    // 复制一份，保证 Int16Array 的 byteOffset 为 0（且 buffer 不被复用）
    const aligned = bytes.slice();
    playPcmChunk(ctx, new Int16Array(aligned.buffer));
  }
}

/** 取（或新建）WebAudio 上下文：采样率与服务端 pcm 一致，避免重采样 */
function ensureAudioCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    const Ctor: typeof AudioContext =
      window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new Ctor({ sampleRate: STREAM_SAMPLE_RATE });
    nextStartTime = 0;
  }
  return audioCtx;
}

/** 播一个 pcm 分片：接在上一分片结束的采样点上，块间零间隙 */
function playPcmChunk(ctx: AudioContext, pcm: Int16Array): void {
  const buffer = ctx.createBuffer(1, pcm.length, STREAM_SAMPLE_RATE);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);

  const startAt = Math.max(nextStartTime, ctx.currentTime);
  source.start(startAt);
  nextStartTime = startAt + buffer.duration;

  activeSources.push(source);
  source.onended = () => {
    const i = activeSources.indexOf(source);
    if (i >= 0) activeSources.splice(i, 1);
  };
}

/**
 * 朗读入口：优先流式（连贯、首包快），不可用时回退整段方案。
 * 页面只需调这一个，不必关心当前走的是哪条链路。
 */
export async function speak(
  text: string,
  opts: { isActive: () => boolean; onPhase?: (phase: 'loading' | 'playing') => void },
): Promise<void> {
  try {
    await streamSpeak(text, opts);
    return;
  } catch (err: any) {
    if (!opts.isActive()) return;
    if (String(err?.name) === 'AbortError') return;

    const streamErr =
      err instanceof TtsError
        ? err
        : new TtsError(String(err?.message || '流式朗读失败'), { permanent: false });

    // 永久性错误（未配置 / 参数错误）：回退整段只会重复失败并重复弹错 —— 一次说清
    if (streamErr.permanent) {
      message.error(streamErr.message);
      return;
    }

    // 瞬时错误（网络中断 / 服务端未部署 / 超时）→ 回退整段
    console.warn('[tts] 流式朗读不可用，回退整段：', streamErr.message);
    stopTts();
    try {
      await speakSequence(splitSpeakParts(text), opts);
    } catch (err2: any) {
      if (!opts.isActive()) return;
      // 整段也失败：只弹一次，且带上服务端真实原因
      message.error(err2?.message || '朗读失败，请重试');
    }
  }
}
