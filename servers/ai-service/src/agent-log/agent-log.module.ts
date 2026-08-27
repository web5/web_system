import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentRun } from './entities/agent-run.entity';
import { AgentLogService } from './agent-log.service';
import { AgentLogController } from './agent-log.controller';
import { AgentLogInternalController } from './agent-log.internal.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([AgentRun]), AuthModule],
  providers: [AgentLogService],
  controllers: [AgentLogController, AgentLogInternalController],
  exports: [AgentLogService, TypeOrmModule],
})
export class AgentLogModule {}
