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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { AgentDefService } from './agent-def.service';
import { SaveAgentDefDto, SetEnabledDto, PublishDto, RollbackDto } from './dto/agent-def.dto';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard, RequirePermission } from '@web-system/shared';

@ApiTags('Agent Definitions (admin)')
@Controller('admin/agent-defs')
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
export class AgentDefController {
  constructor(private readonly defs: AgentDefService) {}

  @Get()
  @RequirePermission('agents:view')
  @ApiOperation({ summary: '列所有 Agent 定义' })
  async list() {
    return this.defs.list();
  }

  @Get(':id')
  @RequirePermission('agents:view')
  @ApiOperation({ summary: 'Agent 定义详情' })
  async get(@Param('id') id: string) {
    return this.defs.get(id);
  }

  @Post()
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: '新建 Agent 定义（草稿）' })
  async create(@Body() dto: SaveAgentDefDto) {
    return this.defs.create(dto.id, dto);
  }

  @Put(':id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: '保存 Agent 定义草稿（不发布）' })
  async update(@Param('id') id: string, @Body() dto: SaveAgentDefDto, @Req() req: Request) {
    return this.defs.update(id, dto, (req as any).user);
  }

  @Post(':id/publish')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: '发布为新版本（生效）' })
  async publish(@Param('id') id: string, @Body() dto: PublishDto, @Req() req: Request) {
    return this.defs.publish(id, (req as any).user, dto.changeNote);
  }

  @Post(':id/enabled')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: '启用/停用 Agent' })
  async setEnabled(@Param('id') id: string, @Body() dto: SetEnabledDto, @Req() req: Request) {
    return this.defs.setEnabled(id, dto.enabled, (req as any).user);
  }

  @Get(':id/versions')
  @RequirePermission('agents:view')
  @ApiOperation({ summary: '历史版本列表' })
  async versions(@Param('id') id: string) {
    return this.defs.listVersions(id);
  }

  @Post(':id/rollback')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: '回滚到指定版本并发布' })
  async rollback(@Param('id') id: string, @Body() dto: RollbackDto, @Req() req: Request) {
    return this.defs.rollback(id, dto.versionId, (req as any).user);
  }

  @Delete(':id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: '删除 Agent 定义（谨慎）' })
  async remove(@Param('id') id: string) {
    return this.defs.remove(id);
  }
}
