import { Controller, Post, Get, Query, Body, Res, HttpCode, HttpStatus, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { TtsService } from './tts.service';
import { TtsStreamService } from './tts-stream.service';
import { AuthGuard } from '../auth/auth.guard';

interface SpeakDto {
  text: string;
  voiceType?: number;
  speed?: number;
  /** 整段合成（默认 true）：超长文本由服务端切片并发合成后拼接为单个 mp3 */
  long?: boolean;
}

@ApiTags('语音合成')
@Controller('ai/tts')
@UseGuards(AuthGuard)
export class TtsController {
  private readonly logger = new Logger(TtsController.name);

  constructor(
    private readonly ttsService: TtsService,
    private readonly ttsStreamService: TtsStreamService,
  ) {}

  @Post('speak')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '文字转语音（TTS）' })
  async speak(@Body() body: SpeakDto, @Res() res: Response): Promise<void> {
    const { text, voiceType, speed } = body;

    if (!text || text.trim().length === 0) {
      res.status(400).json({ code: 400, message: 'text 参数不能为空' });
      return;
    }

    try {
      const audioBuffer =
        body.long === false
          ? await this.ttsService.textToSpeech(text, { voiceType, speed })
          : await this.ttsService.textToSpeechLong(text, { voiceType, speed });

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', audioBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(audioBuffer);
    } catch (error: any) {
      const statusCode = error.message?.includes('未配置') ? 503 : 500;
      res.status(statusCode).json({
        code: statusCode,
        message: error.message || '语音合成失败',
      });
    }
  }

  /**
   * 流式语音合成：把腾讯云 WS 分块下发的音频原样透传（chunked），
   * 端侧边收边播 —— 首包约 0.6s 出声（实测），全程无块间接缝。
   */
  @Get('stream')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: '流式文字转语音（边合成边下发）' })
  async stream(
    @Query('text') text: string,
    @Query('codec') codec: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!text || text.trim().length === 0) {
      res.status(400).json({ code: 400, message: 'text 参数不能为空' });
      return;
    }

    const format: 'pcm' | 'mp3' = codec === 'mp3' ? 'mp3' : 'pcm';
    res.setHeader('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'audio/pcm; rate=16000');
    res.setHeader('Cache-Control', 'no-store');
    // 禁止 nginx 缓冲，否则流式被攒成整包，边收边播失效
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const chunk of this.ttsStreamService.streamSpeech(text, { codec: format })) {
        if (!res.write(chunk)) {
          // 背压：等消费者追上再继续写
          await new Promise<void>((resolve) => res.once('drain', resolve));
        }
      }
      res.end();
    } catch (error: any) {
      this.logger.error(`TTS 流式合成失败: ${error.message}`);
      if (!res.headersSent) {
        const statusCode = error.message?.includes('未配置') ? 503 : 500;
        res.status(statusCode).json({ code: statusCode, message: error.message || '流式语音合成失败' });
      } else {
        res.end(); // 已开始下发音频：只能截断，端侧按播放中断处理
      }
    }
  }
}
