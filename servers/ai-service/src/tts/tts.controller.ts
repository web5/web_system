import { Controller, Post, Body, Res, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { TtsService } from './tts.service';
import { AuthGuard } from '../auth/auth.guard';

interface SpeakDto {
  text: string;
  voiceType?: number;
  speed?: number;
}

@ApiTags('语音合成')
@Controller('ai/tts')
@UseGuards(AuthGuard)
export class TtsController {
  constructor(private readonly ttsService: TtsService) {}

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
      const audioBuffer = await this.ttsService.textToSpeech(text, {
        voiceType,
        speed,
      });

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
}
