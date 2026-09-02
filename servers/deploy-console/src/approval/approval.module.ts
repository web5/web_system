import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { ApprovalService } from './approval.service';
import { SystemSettingsModule } from '../system-settings/system-settings.module';

/**
 * 发布审批门禁模块。
 * PipelineService 注入 ApprovalService 做「提交是否被阻断」判定；
 * approve/reject 的执行动作在 PipelineService（审批通过后恢复执行），本模块不反向依赖 pipeline。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DeployApprovalEntity]),
    // 审批开关（REQUIRE_APPROVAL_ENVS）收在系统设置，页面可维护
    SystemSettingsModule,
  ],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
