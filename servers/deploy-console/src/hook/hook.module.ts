import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployModuleHookEntity } from '../entities/deploy-module-hook.entity';
import { HookService } from './hook.service';
import { HookController } from './hook.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeployModuleHookEntity]),
    // 保存/删除脚本需留审计（含前后脚本 diff）
    AuditModule,
  ],
  controllers: [HookController],
  providers: [HookService],
  exports: [HookService],
})
export class HookModule {}
