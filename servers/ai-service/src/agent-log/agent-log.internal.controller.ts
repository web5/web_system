import {
  Controller,
  Post,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentLogService, RecordRunInput } from './agent-log.service';

/**
 * 内部接口（无需 JWT 鉴权）
 *
 * 用途：让 ai-agent 服务（port 6010）把每次 run 的原始数据推送到 ai-service 统一落库，
 * 这样 admin 在 "Agents" 模块能看到所有 agent（含跨服务）的对话记录。
 *
 * 安全：生产环境通过内网 / Nginx 防火墙限制只能 127.0.0.1 / 容器内网访问。
 *       也可以基于 IP 白名单中间件进一步加固（如果将来开放跨网调用）。
 */
@ApiTags('Agent Runs (internal)')
@Controller('internal/agent-runs')
export class AgentLogInternalController {
  constructor(private readonly log: AgentLogService) {}

  @Post()
  @ApiOperation({ summary: 'ai-agent 推送一次 run 记录' })
  async record(@Body() body: RecordRunInput) {
    const saved = await this.log.recordRun(body);
    return { ok: true, id: saved?.id ?? null };
  }
}
