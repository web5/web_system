import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { Hy3Client } from '../common/http/hy3.client';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [HttpModule, ConversationModule],
  controllers: [AiController],
  providers: [AiService, Hy3Client],
  exports: [AiService],
})
export class AiModule {}
