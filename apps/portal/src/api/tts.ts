/**
 * 朗读（TTS）—— PC 端走后端腾讯云 TTS（统一音色），替代浏览器 Web Speech。
 *
 * 链路：portal → gateway `POST /api/ai/tts/speak`（原生 http 二进制透传）
 *       → ai-service `TtsService`（腾讯云 TTS，音色 603007 邻家女孩，中英混读）→ mp3 二进制。
 *
 * 与小程序 `services/tts.ts` 同一条后端链路；PC 端用 `Audio` 对象播放（小程序用 InnerAudioContext）。
 */
import request from '@/api/request';

/** 单段文本上限（超自然大模型音色；中文约 110 字 / 英文约 110 字符，超过则分句） */
const MAX_CHUNK = 110;

/** 请求一段文本的 TTS 音频（mp3 Blob）；失败抛错（request 拦截器已处理 401 刷新/跳登录） */
export async function requestTts(text: string): Promise<Blob> {
  const data = (await request.post('/ai/tts/speak', { text }, { responseType: 'blob' })) as unknown as Blob;
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

/** 分句切块：句末标点断开，再按 MAX_CHUNK 合并/硬切（对齐小程序 splitSpeakChunks） */
export function splitChunks(text: string, max = MAX_CHUNK): string[] {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];

  const sentences: string[] = [];
  let buf = '';
  for (const ch of t) {
    buf += ch;
    if (/[。！？；.!?;]/.test(ch)) {
      const s = buf.trim();
      if (s) sentences.push(s);
      buf = '';
    }
  }
  if (buf.trim()) sentences.push(buf.trim());
  if (!sentences.length) return [];

  const chunks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (cur) { chunks.push(cur); cur = ''; }
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max));
    } else if ((cur + s).length > max) {
      if (cur) chunks.push(cur);
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
