import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService, UpsertConfigDto } from './config.service';
import { SECRET_UNRECORDED } from './config-crypto';
import { ConfigScope } from '../entities/config-item.entity';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

/**
 * 配置中心（**仅控制台 JWT，不暴露 MCP**）。
 *
 * 安全边界：列表接口对密钥只返回掩码，明文永不回显；
 * 明文只在发布/重启注入进程时于服务端解密使用，不经过任何 HTTP 响应。
 */
@ApiTags('配置中心')
@ApiBearerAuth()
@Controller('config')
export class ConfigController {
  constructor(
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  @Get('items')
  @ApiOperation({ summary: '配置项列表（密钥返回掩码）' })
  list(
    @Query('scope') scope?: ConfigScope,
    @Query('envId') envId?: string,
    @Query('moduleKey') moduleKey?: string,
  ) {
    return this.configService.list(scope, envId, moduleKey);
  }

  @Put('items')
  @ApiOperation({ summary: '新增/更新配置项（密钥加密存储）' })
  async save(@Body() body: UpsertConfigDto, @CurrentUser() user: any) {
    if (!body) throw new BadRequestException('缺少请求体');
    const username = user?.username || 'unknown';

    // 保存前取旧值用于审计 diff；密钥只记"已变更"，绝不明文入审计
    let before: string | null = null;
    try {
      const rows = await this.configService.list(body.scope, body.envId, body.moduleKey);
      const hit = rows.find((r) => r.key === body.key);
      before = hit ? (hit.isSecret ? SECRET_UNRECORDED : hit.value) : null;
    } catch {
      /* 查询失败不阻断保存 */
    }

    const saved = await this.configService.upsert(body, username);

    await this.auditService.log({
      user: username,
      action: before === null ? 'config.create' : 'config.update',
      env: body.envId,
      component: body.moduleKey,
      status: 'success',
      detail: JSON.stringify({
        scope: body.scope,
        key: body.key,
        before,
        after: body.isSecret ? SECRET_UNRECORDED : body.value,
        isSecret: !!body.isSecret,
      }),
      changes: [
        { field: 'value', before, after: body.isSecret ? SECRET_UNRECORDED : body.value },
      ],
    });

    return saved;
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '删除配置项' })
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    const username = user?.username || 'unknown';
    // 删除前先取元数据用于审计（findById 不返回值，避免触碰密钥）
    const target = await this.configService.findById(id);

    await this.configService.remove(id);

    await this.auditService.log({
      user: username,
      action: 'config.delete',
      env: target?.envId,
      component: target?.moduleKey,
      status: 'success',
      detail: JSON.stringify({
        scope: target?.scope ?? null,
        key: target?.key ?? id,
        isSecret: target?.isSecret ?? false,
        value: target?.isSecret ? SECRET_UNRECORDED : null,
      }),
      changes: [
        {
          field: 'value',
          before: target?.isSecret ? SECRET_UNRECORDED : null,
          after: null,
        },
      ],
    });

    return { ok: true };
  }

  @Post('snapshots')
  @ApiOperation({ summary: '生成配置快照（与发布版本关联）' })
  snapshot(
    @Body() body: { envId: string; moduleKey: string; versionTag: string },
    @CurrentUser() user: any,
  ) {
    if (!body?.envId || !body?.moduleKey || !body?.versionTag) {
      throw new BadRequestException('缺少 envId / moduleKey / versionTag');
    }
    return this.configService.snapshot(
      body.envId,
      body.moduleKey,
      body.versionTag,
      user?.username,
    );
  }

  @Post('snapshots/restore')
  @ApiOperation({ summary: '回滚配置到指定版本快照' })
  restore(
    @Body() body: { envId: string; moduleKey: string; versionTag: string },
    @CurrentUser() user: any,
  ) {
    if (!body?.envId || !body?.moduleKey || !body?.versionTag) {
      throw new BadRequestException('缺少 envId / moduleKey / versionTag');
    }
    return this.configService.restore(
      body.envId,
      body.moduleKey,
      body.versionTag,
      user?.username,
    );
  }
}
