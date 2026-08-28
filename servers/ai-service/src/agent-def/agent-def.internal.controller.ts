import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentDefService } from './agent-def.service';

/**
 * 内部接口（无需 JWT 鉴权）
 *
 * 用途：让各服务（ai-agent / ai-service）启动 + 定时轮询拉取 published 且 enabled
 * 的 Agent 定义，覆盖本地 AgentRegistry，实现"改 prompt 运行时生效"。
 *
 * 安全：生产环境通过内网 / Nginx 限制只允许 127.0.0.1 与容器内网访问。
 */
@ApiTags('Agent Definitions (internal)')
@Controller('internal/agent-definitions')
export class AgentDefInternalController {
  constructor(private readonly defs: AgentDefService) {}

  @Get()
  @ApiOperation({ summary: '返回所有已发布且启用的 Agent 定义' })
  async getPublished() {
    return this.defs.getPublished();
  }

  /** seed 端点：一次性把内置定义写入 DB（仅空表时执行） */
  @Get('seed')
  @ApiOperation({ summary: 'seed 内置 Agent 定义到 DB（仅空表时执行）' })
  async seed() {
    return this.defs.seed();
  }
}
