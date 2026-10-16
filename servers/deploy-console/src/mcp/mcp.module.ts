import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpAuthService } from './mcp-auth.service';
import { McpKeyGuard } from './mcp-key.guard';
import { PipelineModule } from '../pipeline/pipeline.module';
import { DeployModule } from '../deploy/deploy.module';
import { ApprovalModule } from '../approval/approval.module';
// release_plan（L1 只读 dry-run）：Agent 在提交前先看影响面与风险
import { ReleasePlanModule } from '../release-plan/release-plan.module';
// verify_release（L1 只读）：发布后比对线上事实，确认发布真的生效
import { ReleaseVerifyModule } from '../release-verify/release-verify.module';

/**
 * MCP 执行接口模块。
 * 只提供 HTTP 接口给 mcp-gateway 调用；MCP 协议层在 mcp-gateway（唯一端点）。
 *
 * `ApprovalModule` 是为了审批路由（`/mcp/pipeline/:jobId/approve|reject`）引入的：
 * `ApproverService` 负责把 MCP Key 的 ownerId 解析成用户名，未导入会直接
 * 「Nest can't resolve dependencies of the McpController」→ 服务起不来。
 */
@Module({
  imports: [
    PipelineModule,
    DeployModule,
    ApprovalModule,
    ReleasePlanModule,
    ReleaseVerifyModule,
  ],
  controllers: [McpController],
  providers: [McpAuthService, McpKeyGuard],
  exports: [McpAuthService],
})
export class McpDeployModule {}
