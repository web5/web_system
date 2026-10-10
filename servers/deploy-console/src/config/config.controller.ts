import { createHash } from 'crypto';
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
import { InternalGuardService } from '../common/internal-guard.service';
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
    // 诊断 #7：内部下发接口同样要限流 + 留痕（它把配置明文交给脚本）
    private readonly internalGuard: InternalGuardService,
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
    const env = String(envId || '').trim();
    const key = String(serviceKey || '').trim();
    if (!env) throw new BadRequestException('envId 必填');
    if (!key) throw new BadRequestException('serviceKey 必填');

    const runId = String((req?.query?.runId as string) || '').trim() || null;
    let emptyReason = '';
    // 鉴权 + 限流 + 来源白名单 + 审计（审计失败不阻断，见 InternalGuardService）
    const items = await this.internalGuard.run(
      req,
      { action: 'internal.config.dispatch', env, component: key },
      async () => {
        // 按需：没有 module 级条目 = 该服务没在配置中心声明需要配置 → 不下发（免得凭空落盘）
        if (!(await this.configService.hasModuleScope(env, key))) {
          emptyReason = 'no-module-scope';
          return null;
        }
        const payload = await this.configService.dispatchPayload(env, key);
        if (!payload.length) emptyReason = 'no-deliverable-key';
        return payload;
      },
      // 只记「下发了多少个键」，明文与键名一律不进审计
      (r) => (r ? `下发配置 ${r.length} 个键` : '无 module 级条目，未下发（204）'),
    );

    return this.finishDispatch({
      res,
      items,
      env,
      serviceKey: key,
      host: req?.ip ?? null,
      runId,
      emptyReason,
    });
  }

  /**
   * 收口「下发结果」：有内容则 200 + 文本，无内容则 204；两种情况**都落下发记录**。
   *
   * 为什么 204 也要记：脚本拿到 204 会保留目标机现状，若某次配置明明配了却返回 204，
   * 只有记录里写明原因（`no-module-scope` / `no-deliverable-key`）才能事后查清，
   * 否则现象会是"配了没生效"且无从下手。
   */
  private async finishDispatch(args: {
    res: Response;
    items: { key: string; value: string; scope: string }[] | null;
    env: string;
    serviceKey: string;
    host: string | null;
    runId: string | null;
    emptyReason: string;
  }): Promise<void> {
    const { res, items, env, serviceKey, host, runId } = args;
    const meta = { envId: env, moduleKey: serviceKey, host, runId, dispatchedBy: 'internal-dispatch' };

    if (!items || !items.length) {
      await this.configService.recordDelivery({
        ...meta,
        keyCount: 0,
        contentHash: null,
        result: 'empty',
        // 记清原因：排查"配了没生效"时，这是唯一能区分「没到配置中心」还是「被层过滤」的依据
        emptyReason: args.emptyReason || null,
      });
      res.status(204).end();
      return;
    }

    const content = renderGeneratedEnvFile(items, { envId: env, serviceKey });
    await this.configService.recordDelivery({
      ...meta,
      keyCount: items.length,
      contentHash: createHash('sha256').update(content).digest('hex'),
      result: 'delivered',
    });
    res.status(200).type('text/plain; charset=utf-8').send(content);
  }

  /**
   * 内部：目标机上报「实际生效的配置内容 hash」。
   *
   * 用途：与最近一次下发的 hash 比对，得到是否漂移（**漂移检测的实际态来源**，设计 P0-3）。
   * 只上报 hash、不上报内容 —— 避免把目标机的配置明文明文回流到平台。
   */
  @Public()
  @ApiHeader({ name: 'x-internal-key', description: '内部服务密钥' })
  @Post('internal/report')
  @ApiOperation({ summary: '内部：目标机上报实际配置 hash（漂移检测）' })
  async reportDelivery(
    @Body() body: { envId?: string; moduleKey?: string; contentHash?: string },
    @Req() req: any,
  ) {
    const env = String(body?.envId || '').trim();
    const mod = String(body?.moduleKey || '').trim();
    const hash = String(body?.contentHash || '').trim();
    if (!env) throw new BadRequestException('envId 必填');
    if (!mod) throw new BadRequestException('moduleKey 必填');
    if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
      throw new BadRequestException('contentHash 必填且须为 sha256（64 位 hex）');
    }

    return this.internalGuard.run(
      req,
      { action: 'internal.config.report', env, component: mod },
      () => this.configService.reportDelivery({ envId: env, moduleKey: mod, reportedHash: hash, host: req?.ip ?? null }),
      (r) => (r.deliveryId ? `回执已记（drift=${r.drift}）` : '未找到对应下发记录'),
    );
  }

  /** 下发记录列表（含目标机回执与漂移标记） */
  @Get('deliveries')
  @ApiOperation({ summary: '配置下发记录（含目标机回执 / 漂移）' })
  deliveries(
    @Query('envId') envId?: string,
    @Query('moduleKey') moduleKey?: string,
    @Query('limit') limit?: string,
  ) {
    return this.configService.listDeliveries({
      envId,
      moduleKey,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** 配置变更历史（密钥只显指纹，不显示值） */
  @Get('revisions')
  @ApiOperation({ summary: '配置变更历史（值不回显，仅指纹）' })
  revisions(
    @Query('scope') scope?: string,
    @Query('envId') envId?: string,
    @Query('moduleKey') moduleKey?: string,
    @Query('key') key?: string,
    @Query('limit') limit?: string,
  ) {
    return this.configService.listRevisions({
      scope,
      envId,
      moduleKey,
      key,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * 单键回滚：把指定变更记录的值写回配置项。
   *
   * ⚠️ 这是**改数据**的操作，因此：detail 不回显值（只回键与 revision id），
   * 审计里记的是"回滚到哪条记录"而非值本身（与 config.update 同口径）。
   */
  @Post('rollback')
  @ApiOperation({ summary: '回滚配置项到指定变更记录' })
  async rollback(@Body() body: { revisionId: string }, @CurrentUser() user: any) {
    const revisionId = String(body?.revisionId || '').trim();
    if (!revisionId) throw new BadRequestException('缺少 revisionId');
    const username = user?.username || 'unknown';

    const saved = await this.configService.rollbackToRevision(revisionId, username);

    await this.auditService.log({
      user: username,
      action: 'config.rollback',
      env: saved.envId,
      component: saved.moduleKey,
      status: 'success',
      detail: JSON.stringify({
        scope: saved.scope,
        key: saved.key,
        revisionId,
        value: SECRET_UNRECORDED,
      }),
      changes: [{ field: 'value', before: SECRET_UNRECORDED, after: SECRET_UNRECORDED }],
    });
    return { ok: true, key: saved.key, scope: saved.scope };
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

    // 传操作人：删除同样要进 config_revisions（否则删了什么无从追溯）
    await this.configService.remove(id, username);

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
