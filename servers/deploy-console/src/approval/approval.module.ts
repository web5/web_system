import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { ApprovalService } from './approval.service';
// 可审批人：按权限码 deploy:pipeline:approve 从 user-service 拉取（方案 B）
import { ApproverService } from './approver.service';
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
  providers: [ApprovalService, ApproverService],
  exports: [ApprovalService, ApproverService],
})
export class ApprovalModule {}
