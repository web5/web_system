import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { SkillService } from './skill.service';
import { SaveSkillDto } from './dto/skill.dto';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard, RequirePermission } from '@web-system/shared';

/**
 * 技能库管理 API（admin）
 *   GET    /admin/skills            技能列表
 *   GET    /admin/skills/:code      详情（含正文）
 *   POST   /admin/skills            新建
 *   PUT    /admin/skills/:code      编辑（全量覆盖）
 *   DELETE /admin/skills/:code      删除
 *   POST   /admin/skills/import     zip 技能包一键导入
 */
@ApiTags('Skills (admin)')
@Controller('admin/skills')
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
export class SkillController {
  constructor(private readonly svc: SkillService) {}

  @Get()
  @RequirePermission('skills:view')
  @ApiOperation({ summary: '技能列表' })
  list() {
    return this.svc.list();
  }

  @Get(':code')
  @RequirePermission('skills:view')
  @ApiOperation({ summary: '技能详情（含正文）' })
  get(@Param('code') code: string) {
    return this.svc.get(code);
  }

  @Post()
  @RequirePermission('skills:manage')
  @ApiOperation({ summary: '新建技能' })
  create(@Body() dto: SaveSkillDto, @Req() req: Request) {
    return this.svc.create(dto, (req as any).user);
  }

  @Put(':code')
  @RequirePermission('skills:manage')
  @ApiOperation({ summary: '编辑技能（全量覆盖）' })
  update(@Param('code') code: string, @Body() dto: SaveSkillDto, @Req() req: Request) {
    return this.svc.update(code, dto, (req as any).user);
  }

  @Delete(':code')
  @RequirePermission('skills:manage')
  @ApiOperation({ summary: '删除技能' })
  remove(@Param('code') code: string) {
    return this.svc.remove(code);
  }

  @Post('import')
  @RequirePermission('skills:manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'zip 技能包一键导入（解析 SKILL.md frontmatter + 正文）' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    }),
  )
  async importZip(@UploadedFile() file: any, @Req() req: Request) {
    if (!file) throw new BadRequestException('请上传 zip 技能包（字段名 file）');
    return this.svc.importZip(file.buffer, (req as any).user);
  }
}
