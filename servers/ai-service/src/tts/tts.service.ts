import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';

const TtsClient = tencentcloud.tts.v20190823.Client;

/** 腾讯云 TTS 音色（603007 邻家女孩：超自然大模型音色，支持中英混读） */
const EN_VOICES: Record<string, number> = {
  female: 603007, // 邻家女孩（聊天女声 · 超自然大模型音色 · 中英混读）
  male: 502007, // 智小虎（聊天童声 · 超自然大模型音色 · 中英混读）
};

/**
 * 单次合成的文本上限（实测音色 603007：英文 499 成功 / 520 报 Text too long；
 * 中文 150 成功 / 300 报 Text too long → 中英必须分开设限，取实测安全值留余量）。
 */
const TTS_TEXT_LIMIT = { en: 480, zh: 150 } as const;

/** 句末标点（中英）：切片优先在这里断开，接缝落在自然停顿处 */
const SENTENCE_END = '.!?;。！？；…';

/** 拼接合成时的并发上限：单片常驻 ~6s，串行会打爆 gateway 15s 超时；并发过高有云厂商限流风险 */
const CONCAT_CONCURRENCY = 3;

@Injectable()
export class TtsService {
  private readonly logger = new Logger(TtsService.name);
  private client: InstanceType<typeof TtsClient> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.initClient();
  }

  private initClient(): void {
    const secretId = this.configService.get<string>('TENCENT_SECRET_ID');
    const secretKey = this.configService.get<string>('TENCENT_SECRET_KEY');

    if (!secretId || !secretKey) {
      this.logger.warn('TTS 未配置：缺少 TENCENT_SECRET_ID / TENCENT_SECRET_KEY，语音合成将不可用');
      return;
    }

    this.client = new TtsClient({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou',
      profile: {
        httpProfile: { endpoint: 'tts.tencentcloudapi.com' },
      },
    });

    this.logger.log('腾讯云 TTS 客户端初始化成功');
  }

  /**
   * 将文本转为语音 MP3 Buffer（单次合成，文本须在厂商上限内）。
   * @param text 要朗读的文本
   * @param options 可选参数
   */
  async textToSpeech(
    text: string,
    options?: { voiceType?: number; speed?: number; volume?: number },
  ): Promise<Buffer> {
    if (!this.client) {
      throw new Error('TTS 未配置，请在 .env 中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY');
    }

    try {
      // 603007 邻家女孩支持中英混读：PrimaryLanguage 按文本是否含中文选择主语言（1=中文 2=英文）
      const primaryLanguage = /[\u4e00-\u9fff]/.test(text) ? 1 : 2;
      const response = await this.client.TextToVoice({
        Text: text,
        SessionId: '',
        VoiceType: options?.voiceType ?? EN_VOICES.female,
        Codec: 'mp3',
        SampleRate: 16000,
        Speed: options?.speed ?? 0,
        Volume: options?.volume ?? 5,
        PrimaryLanguage: primaryLanguage,
      });

      if (!response.Audio) {
        throw new Error('TTS 返回数据为空');
      }

      return Buffer.from(response.Audio, 'base64');
    } catch (error: any) {
      this.logger.error(`TTS 合成失败: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 整段合成：文本在单次上限内走一次合成（语调完全连贯）；超限时按句切片、
   * 并发合成后拼接成单个 MP3 返回（调用方拿到的始终是完整整段）。
   *
   * 拼接合法性：腾讯云返回的 mp3 无 ID3 头，各片首帧恒为 `ff f3 48 c4`（同音色 /
   * 同 SampleRate / 同 Codec），裸 concat 可被播放器连续解码。
   */
  async textToSpeechLong(
    text: string,
    options?: { voiceType?: number; speed?: number; volume?: number },
  ): Promise<Buffer> {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) throw new Error('text 参数不能为空');

    const limit = /[\u4e00-\u9fff]/.test(normalized) ? TTS_TEXT_LIMIT.zh : TTS_TEXT_LIMIT.en;
    const pieces = this.splitForTts(normalized, limit);

    if (pieces.length === 1) {
      return this.textToSpeech(pieces[0], options);
    }

    this.logger.log(`TTS 整段合成：${normalized.length} 字符 → ${pieces.length} 片并发合成`);
    const parts = await this.mapLimit(pieces, CONCAT_CONCURRENCY, (piece) =>
      this.textToSpeech(piece, options),
    );
    return Buffer.concat(parts);
  }

  /**
   * 按上限切片：先按句末标点切句并合并相邻短句（减少片数），
   * 单句仍超限时在空格处切（不切碎单词），极端无空格才硬切。
   */
  private splitForTts(text: string, limit: number): string[] {
    if (text.length <= limit) return [text];

    const sentences: string[] = [];
    let buf = '';
    for (const ch of text) {
      buf += ch;
      if (SENTENCE_END.indexOf(ch) >= 0) {
        const s = buf.trim();
        if (s) sentences.push(s);
        buf = '';
      }
    }
    if (buf.trim()) sentences.push(buf.trim());
    if (!sentences.length) return this.hardSplit(text, limit);

    const pieces: string[] = [];
    let cur = '';
    for (const s of sentences) {
      if (s.length > limit) {
        if (cur) {
          pieces.push(cur);
          cur = '';
        }
        for (const p of this.hardSplit(s, limit)) pieces.push(p);
        continue;
      }
      if (!cur) {
        cur = s;
      } else if (cur.length + 1 + s.length <= limit) {
        cur = `${cur} ${s}`;
      } else {
        pieces.push(cur);
        cur = s;
      }
    }
    if (cur) pieces.push(cur);

    return pieces.length ? pieces : this.hardSplit(text, limit);
  }

  /** 超长单句：优先在空格处切成 ≤ limit 的片（不切碎单词） */
  private hardSplit(text: string, limit: number): string[] {
    const out: string[] = [];
    let seg = text;
    while (seg.length > limit) {
      let cut = seg.lastIndexOf(' ', limit);
      if (cut < limit * 0.5) cut = limit; // 前半段没有空格：只能硬切
      const piece = seg.slice(0, cut).trim();
      if (piece) out.push(piece);
      seg = seg.slice(cut).trim();
    }
    if (seg) out.push(seg);
    return out;
  }

  /** 带并发上限的 map（保序）：避免串行超时，也避免一次打满触发云厂商限流 */
  private async mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        out[index] = await fn(items[index]);
      }
    });
    await Promise.all(workers);
    return out;
  }
}
