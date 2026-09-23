import { Module } from '@nestjs/common';
import { TtsService } from './tts.service';
import { TtsStreamService } from './tts-stream.service';
import { TtsController } from './tts.controller';

@Module({
  controllers: [TtsController],
  providers: [TtsService, TtsStreamService],
  exports: [TtsService, TtsStreamService],
})
export class TtsModule {}
