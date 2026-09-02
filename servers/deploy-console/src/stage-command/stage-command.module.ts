import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployModuleStageCommandEntity } from '../entities/deploy-module-stage-command.entity';
import { StageCommandService } from './stage-command.service';
import { StageCommandController } from './stage-command.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeployModuleStageCommandEntity]),
    // 保存/删除阶段命令需留审计（含前后命令 diff）
    AuditModule,
  ],
  controllers: [StageCommandController],
  providers: [StageCommandService],
  exports: [StageCommandService],
})
export class StageCommandModule {}
