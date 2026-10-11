import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
  HttpException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AsrService } from './asr.service';
import { AuthGuard } from '../auth/auth.guard';

interface RecognizeDto {
  /** 音频内容（base64，不含 data URI 前缀） */
  audio: string;
  /** 音频格式：mp3 / wav / pcm / aac / amr / m4a，默认 mp3 */
  format?: string;
}

@ApiTags('语音识别')
@Controller('ai/asr')
@UseGuards(AuthGuard)
export class AsrController {
  private readonly logger = new Logger(AsrController.name);

  constructor(private readonly asrService: AsrService) {}

  /**
   * ASR 配置健康检查。
   *
   * 为什么需要（与 TTS 同一口径）：2026-10-09 事故中 dev/prod 缺 `TENCENT_*` 凭据
   * 长达数月无人发现 —— 除「用户点了报错」外没有任何可观测信号。有了这个端点，
   * 前端可在未配置时**禁用麦克风按钮**，运维/CI 也能直接探活。
   *
   * 只回布尔，不回任何凭据信息（明文、掩码都不回）。
   */
  @Get('health')
  @ApiOperation({ summary: 'ASR 配置健康检查（凭据是否可用）' })
  health() {
    return { configured: this.asrService.isAvailable() };
  }

  /**
   * 语音识别（一句话识别）：base64 音频 → 文本。
   *
   * 为什么用 base64 而不是 multipart：网关对 JSON body 的转发链路是现成的
   * （TTS 已验证），而请求体二进制透传未在网关侧验证过；base64 走 JSON 更稳。
   * 代价是体积膨胀约 33%，实际语音（≤60s mp3）在数百 KB 级，可接受。
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '语音识别（≤60s，返回文本）' })
  async recognize(@Body() dto: RecognizeDto) {
    try {
      const result = await this.asrService.recognize(dto?.audio, dto?.format || 'mp3');
      return { text: result.text, durationMs: result.durationMs };
    } catch (e) {
      const msg = e instanceof Error ? e.message : '识别失败';
      this.logger.warn(`ASR 识别失败: ${msg}`);
      // 400 = 用户侧可重试的问题（音频为空/过长/没听清）
      // 503 = 服务端/运维侧问题（凭据没配、云上服务未开通）—— 不该让用户反复重试
      const status = /未配置|未开通/.test(msg)
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.BAD_REQUEST;
      throw new HttpException({ message: msg }, status);
    }
  }
}
