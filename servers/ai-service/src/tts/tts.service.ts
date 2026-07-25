import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';

const TtsClient = tencentcloud.tts.v20190823.Client;

/** 腾讯云 TTS 英文发音人 */
const EN_VOICES: Record<string, number> = {
  female: 603007, // 邻家女孩（聊天女声 · 超自然大模型音色）
  male: 502007, // 智小虎（聊天童声 · 超自然大模型音色）
};

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
   * 将文本转为语音 MP3 Buffer
   * @param text 要朗读的英语文本
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
      const response = await this.client.TextToVoice({
        Text: text,
        SessionId: '',
        VoiceType: options?.voiceType ?? EN_VOICES.female,
        Codec: 'mp3',
        SampleRate: 16000,
        Speed: options?.speed ?? 0,
        Volume: options?.volume ?? 5,
        PrimaryLanguage: 2,
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
}
