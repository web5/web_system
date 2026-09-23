import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
// ⚠️ 必须用 namespace import：本服务 tsconfig 只有 allowSyntheticDefaultImports（不发
// __importDefault 包装），写成 `import WebSocket from 'ws'` 会在运行时得到
// `ws_1.default is not a constructor`。
import * as WebSocket from 'ws';

/**
 * 腾讯云流式文本语音合成（WebSocket）——边合成边下发，端侧边收边播。
 *
 * 协议要点见 specs/tts-continuity/design.md §10（官方文档 product/1073/108595）：
 *   wss://tts.cloud.tencent.com/stream_wsv2?{参数}
 *   握手 → 等 ready=1 → 逐句 ACTION_SYNTHESIS → 收 binary 音频帧 → ACTION_COMPLETE → final=1
 *
 * 两个必须遵守的点：
 *   1. AppId 参与签名（与云 API 3.0 的 TC3 签名不同，本接口是自研签名）；
 *   2. 服务端断句标点不含英文句点 "."，整段一把梭会长时间缓存不出音频 —— 必须逐句发送。
 */
const STREAM_HOST = 'tts.cloud.tencent.com';
const STREAM_PATH = '/stream_wsv2';
const DEFAULT_VOICE = 603007; // 邻家女孩（超自然大模型音色 · 中英混读），实测支持流式

/** 句末标点处断句（服务端 Node 支持 lookbehind，与小程序端不同） */
const SENTENCE_SPLIT = /(?<=[.!?;。！？；…])\s+/;

/** 整段流式合成的总超时（含握手） */
const STREAM_TIMEOUT_MS = 30_000;

@Injectable()
export class TtsStreamService {
  private readonly logger = new Logger(TtsStreamService.name);

  constructor(private readonly configService: ConfigService) {}

  /** 流式合成所需凭据（比单次合成多一个 AppId） */
  private credentials(): { secretId: string; secretKey: string; appId: string } | null {
    const secretId = this.configService.get<string>('TENCENT_SECRET_ID');
    const secretKey = this.configService.get<string>('TENCENT_SECRET_KEY');
    const appId = this.configService.get<string>('TENCENT_APP_ID');
    if (!secretId || !secretKey || !appId) return null;
    return { secretId, secretKey, appId };
  }

  /** 是否已具备流式合成条件（未配置时端侧应回退整段合成） */
  isAvailable(): boolean {
    return this.credentials() !== null;
  }

  /**
   * 流式合成：建立 WS 连接并逐块产出音频分片（拉取式，天然背压）。
   * @param text 待合成文本
   * @param options codec 默认 pcm（端侧零解码）；voiceType 默认 603007
   */
  async *streamSpeech(
    text: string,
    options?: { voiceType?: number; codec?: 'pcm' | 'mp3'; speed?: number; volume?: number },
  ): AsyncGenerator<Buffer> {
    const cred = this.credentials();
    if (!cred) {
      throw new Error(
        'TTS 流式未配置：请在 .env 中设置 TENCENT_APP_ID / TENCENT_SECRET_ID / TENCENT_SECRET_KEY',
      );
    }

    const normalized = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) throw new Error('text 参数不能为空');

    const codec = options?.codec ?? 'pcm';
    const sessionId = crypto.randomUUID();
    const url = this.buildUrl(cred, sessionId, {
      codec,
      voiceType: options?.voiceType ?? DEFAULT_VOICE,
      speed: options?.speed ?? 0,
      volume: options?.volume ?? 0,
    });

    const queue: Buffer[] = [];
    const waiters: Array<() => void> = [];
    const wake = () => {
      waiters.splice(0).forEach((w) => w());
    };

    let finished = false;
    let failure: Error | null = null;
    let sent = false;

    const ws = new WebSocket(url, { perMessageDeflate: false });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        queue.push(Buffer.from(data));
        wake();
        return;
      }
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return; // 非 JSON 文本帧：忽略
      }
      if (msg?.code !== 0) {
        failure = new Error(`TTS 流式错误 ${msg.code}: ${msg.message}`);
        wake();
        ws.close();
        return;
      }
      if (msg.ready === 1 && !sent) {
        sent = true;
        // 逐句发送：服务端按标点断句合成，英文句点不在其断句集合内，必须按句发
        for (const sentence of normalized.split(SENTENCE_SPLIT)) {
          if (!sentence.trim()) continue;
          ws.send(
            JSON.stringify({
              session_id: sessionId,
              message_id: crypto.randomUUID(),
              action: 'ACTION_SYNTHESIS',
              data: sentence,
            }),
          );
        }
        ws.send(
          JSON.stringify({
            session_id: sessionId,
            message_id: crypto.randomUUID(),
            action: 'ACTION_COMPLETE',
            data: '',
          }),
        );
        return;
      }
      if (msg.final === 1) {
        finished = true;
        wake();
        ws.close();
      }
    });

    ws.on('error', (err: Error) => {
      failure = err;
      finished = true;
      wake();
    });

    ws.on('close', () => {
      finished = true;
      wake();
    });

    const startedAt = Date.now();
    try {
      while (true) {
        if (queue.length) {
          yield queue.shift() as Buffer;
          continue;
        }
        if (failure) throw failure;
        if (finished) break;
        if (Date.now() - startedAt > STREAM_TIMEOUT_MS) {
          throw new Error('TTS 流式合成超时');
        }
        // 等新分片；5s 兜底轮询，避免极端情况下漏唤醒导致永久挂起
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(() => {
            const i = waiters.indexOf(resolve);
            if (i >= 0) waiters.splice(i, 1);
            resolve();
          }, 5000);
        });
      }
    } finally {
      try {
        ws.close();
      } catch {
        /* 已关闭：忽略 */
      }
    }

    if (failure) throw failure;

    this.logger.log(
      `TTS 流式完成：${normalized.length} 字符 / ${codec} / ${Date.now() - startedAt}ms`,
    );
  }

  /**
   * 构建带签名的 WebSocket URL。
   * 签名原文 = GET + 域名 + 路径 + ? + 除 Signature 外参数按字典序拼接（AppId 参与）
   */
  private buildUrl(
    cred: { secretId: string; secretKey: string; appId: string },
    sessionId: string,
    opts: { codec: string; voiceType: number; speed: number; volume: number },
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      Action: 'TextToStreamAudioWSv2',
      AppId: Number(cred.appId), // 文档要求整型
      Codec: opts.codec,
      Expired: now + 3600,
      SampleRate: 16000,
      SecretId: cred.secretId,
      SessionId: sessionId,
      Speed: opts.speed,
      Timestamp: now,
      VoiceType: opts.voiceType,
      Volume: opts.volume,
    };
    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const raw = `GET${STREAM_HOST}${STREAM_PATH}?${sorted}`;
    const signature = crypto.createHmac('sha1', cred.secretKey).update(raw).digest('base64');
    return `wss://${STREAM_HOST}${STREAM_PATH}?${sorted}&Signature=${encodeURIComponent(signature)}`;
  }
}
