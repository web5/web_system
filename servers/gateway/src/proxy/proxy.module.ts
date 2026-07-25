import { Module } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { ProxyController } from './proxy.controller';
import { UploadsController } from './uploads.controller';

@Module({
  controllers: [ProxyController, UploadsController],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
