import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { ConfigService, UpsertConfigDto, renderGeneratedEnvFile } from './config.service';
import { SECRET_UNRECORDED } from './config-crypto';
import { ConfigScope } from '../entities/config-item.entity';
import { CurrentUser } from '../common/decorators';
import { assertInternalKey } from '../common/internal-key';
import { Public } from '../auth/public.decorator';
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

  /**
   * 内部：返回**可下发的 env 文本**，供流水线 `restart` 动作脚本落盘 `.env.generated`。
   *
   * 为什么脚本自己去取（而不是平台代写）：restart 动作是 **DB 脚本**，跑在发布机本地；
   * 只有控制台持有 `CONFIG_MASTER_KEY` 与配置中心连接，故脚本 `curl` 本机控制台即可
   * （`CONSOLE_API` / `CONSOLE_TOKEN` 由引擎注入）—— 参见
   * `specs/service-config-delivery/design.md` §4.3 第 2 条 / §7 P1。
   *
   * 语义与 `DeployService.writeGeneratedEnv` 一致（按需 / 过滤保留键 / 带来源作用域注释）：
   * - `200` text/plain：有可下发的键（内容即为 `.env.generated` 正文）
   * - `204`：该「环境 × 服务」没有 `module` 级条目，或没有可下发的键 → 脚本保留现状
   * - `401`：`x-internal-key` 不正确 / 服务未配置 `INTERNAL_API_KEY`
   */
  @Public()
  @ApiHeader({ name: 'x-internal-key', description: '内部服务密钥（脚本侧 CONSOLE_TOKEN）' })
  @Get('internal/dispatch/:serviceKey')
  @ApiOperation({ summary: '内部：配置下发内容（纯文本 env，x-internal-key 鉴权）' })
  async dispatch(
    @Param('serviceKey') serviceKey: string,
    @Query('envId') envId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    assertInternalKey(req);
    const env = String(envId || '').trim();
    const key = String(serviceKey || '').trim();
    if (!env) throw new BadRequestException('envId 必填');
    if (!key) throw new BadRequestException('serviceKey 必填');

    // 按需：没有 module 级条目 = 该服务没在配置中心声明需要配置 → 不下发（免得凭空落盘）
    if (!(await this.configService.hasModuleScope(env, key))) {
      return res.status(204).end();
    }
    const items = await this.configService.dispatchPayload(env, key);
    if (!items.length) {
      return res.status(204).end();
    }
    return res
      .status(200)
      .type('text/plain; charset=utf-8')
      .send(renderGeneratedEnvFile(items, { envId: env, serviceKey: key }));
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
