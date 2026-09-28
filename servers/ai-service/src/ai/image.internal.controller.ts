import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ImageSubmitDto, ImageQueryDto } from './dto/image-gen.dto';

/**
 * 内部接口（无需 JWT 鉴权；同 internal/agent-definitions 口径：
 * 生产环境靠内网 / 网关隔离——gateway 的 ai 代理保留 /ai 前缀，/internal/* 不可经公网到达）。
 *
 * 用途：ai-agent 的 image-gen 工具经此提交/查询生图任务。
 * IMAGE_GEN_API_KEY 只在本服务 .env 持有，ai-agent 经 AI_SERVICE_URL 复用，
 * 避免密钥双份配置（.env 漂移事故口径）。
 */
@ApiTags('Image Gen (internal)')
@Controller('internal/image')
export class ImageInternalController {
  constructor(private readonly aiService: AiService) {}

  /** 提交生图任务，返回 { id, created } */
  @Post('submit')
  @ApiOperation({ summary: '提交生图任务（内部，供 ai-agent 工具调用）' })
  async submit(@Body() dto: ImageSubmitDto) {
    return this.aiService.submitImage(dto);
  }

  /** 查询生图任务结果：{ id, status, results, done } */
  @Post('query')
  @ApiOperation({ summary: '查询生图任务结果（内部，供 ai-agent 工具调用）' })
  async query(@Body() dto: ImageQueryDto) {
    return this.aiService.queryImage(dto);
  }
}
