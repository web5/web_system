import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OcrService } from './ocr.service';
import { OcrRecognizeDto } from './dto/ocr-recognize.dto';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('OCR')
@Controller('ocr')
@UseGuards(AuthGuard)
export class OcrController {
  private readonly logger = new Logger(OcrController.name);

  constructor(private readonly ocrService: OcrService) {}

  @Post('recognize')
  @ApiOperation({ summary: 'OCR 识别合同图片文字，返回识别文本' })
  async recognize(@Body() dto: OcrRecognizeDto) {
    const result = await this.ocrService.recognize(dto.imageBase64);
    return { code: 0, data: result, message: 'success' };
  }
}
