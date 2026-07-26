import { Module } from '@nestjs/common';
import { MiniScanController } from './mini-scan.controller';

@Module({
  controllers: [MiniScanController],
})
export class MiniScanModule {}
