import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserMemoryEntity } from './user-memory.entity';
import { UserMemorySummaryEntity } from './user-memory-summary.entity';
import { UserMemoryService } from './user-memory.service';
import { UserMemorySummaryService } from './user-memory-summary.service';
import { AiAgentSummaryClient } from './ai-agent-summary.client';
import { UserMemoryController } from './user-memory.controller';
import { UserMemoryAdminController } from './user-memory-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserMemoryEntity, UserMemorySummaryEntity]), AuthModule],
  controllers: [UserMemoryController, UserMemoryAdminController],
  providers: [UserMemoryService, UserMemorySummaryService, AiAgentSummaryClient],
  exports: [UserMemoryService, UserMemorySummaryService],
})
export class UserMemoryModule {}
