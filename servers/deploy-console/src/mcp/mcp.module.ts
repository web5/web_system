import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpAuthService } from './mcp-auth.service';
import { McpKeyGuard } from './mcp-key.guard';
import { PipelineModule } from '../pipeline/pipeline.module';
import { DeployModule } from '../deploy/deploy.module';

/**
 * MCP 执行接口模块。
 * 只提供 HTTP 接口给 mcp-gateway 调用；MCP 协议层在 mcp-gateway（唯一端点）。
 */
@Module({
  imports: [PipelineModule, DeployModule],
  controllers: [McpController],
  providers: [McpAuthService, McpKeyGuard],
  exports: [McpAuthService],
})
export class McpDeployModule {}
