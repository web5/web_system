import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkillService } from './skill.service';

/**
 * 技能内部接口（无需 JWT，供 ai-agent SkillProvider 按需拉取技能正文）
 * GET /internal/skills/:code → { code, name, description, version, content, requiredTools }
 *
 * 安全：生产环境通过内网 / Nginx 限制只允许 127.0.0.1 与容器内网访问。
 */
@ApiTags('Skills (internal)')
@Controller('internal/skills')
export class SkillInternalController {
  constructor(private readonly svc: SkillService) {}

  @Get(':code')
  @ApiOperation({ summary: '按 code 返回技能完整定义（含正文，供 on-demand 加载）' })
  async get(@Param('code') code: string) {
    try {
      return await this.svc.get(code);
    } catch {
      throw new NotFoundException(`技能 ${code} 不存在`);
    }
  }
}
