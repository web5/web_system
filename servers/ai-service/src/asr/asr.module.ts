import { Module } from '@nestjs/common';
import { AsrService } from './asr.service';
import { AsrController } from './asr.controller';

@Module({
  controllers: [AsrController],
  providers: [AsrService],
  exports: [AsrService],
})
export class AsrModule {}
