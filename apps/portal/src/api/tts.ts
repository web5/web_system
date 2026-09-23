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
import request from '@/api/request';
import { API_TIMEOUT } from '@web-system/shared';

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

/** 请求一段文本的 TTS 音频（mp3 Blob）；失败抛错（request 拦截器已处理 401 刷新/跳登录） */
export async function requestTts(text: string): Promise<Blob> {
  // 单片合成实测 2~6s，超过 DEFAULT(10s)：必须单独放宽超时
  const data = (await request.post(
    '/ai/tts/speak',
    { text },
    { responseType: 'blob', timeout: API_TIMEOUT.TTS },
  )) as unknown as Blob;
  return data;
}

/** 全局音频播放器（单例：新的播放顶掉旧的，与小程序 services/tts.ts 同一语义） */
let currentAudio: HTMLAudioElement | null = null;

/** 停止播放：中断当前音频并复位 */
export function stopTts(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
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
  const pending = chunks.map((c) => requestTts(c).catch(() => null));

  const first = await pending[0];
  if (!opts.isActive()) return;
  if (!first) throw new Error('朗读失败，请重试');
  opts.onPhase?.('playing');

  let blob: Blob = first;
  for (let i = 0; i < chunks.length; i++) {
    await playTtsBlob(blob);
    if (!opts.isActive()) return;
    if (i + 1 >= chunks.length) return;

    const next = await pending[i + 1];
    if (!next) throw new Error('朗读失败，请重试');
    blob = next;
  }
}
