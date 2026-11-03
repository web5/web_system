import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import * as path from 'path';
import { ROLE_PERMISSIONS } from '@web-system/types';
import { RequirePermission } from '../auth/decorators';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { StorageDirDto } from './storage.dto';
import {
  DEFAULT_UPLOAD_DIR,
  StorageService,
  STORAGE_ALLOWED_ROOTS_ENV,
  STORAGE_TEMP_DIR_ENV,
  STORAGE_UPLOAD_DIR_ENV,
  TEMP_DIR_SEGMENT,
} from './storage.service';

/** 当前请求的登录用户是否持有某权限码（口径与 PermissionsGuard 一致：按角色展开） */
function hasPermission(req: Request, code: string): boolean {
  const roles = (req as Request & { user?: { roles?: string[] } }).user?.roles ?? [];
  return roles.some((role) =>
    ((ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? []).includes(code),
  );
}

/** 从请求里取审计用的操作者与来源 IP（不引入新依赖，够用即可） */
function auditContext(req: Request): { operator: string; ip: string } {
  const user = (req as Request & { user?: { username?: string; id?: string } }).user;
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ||
    req.ip ||
    '0.0.0.0';
  return { operator: user?.username || user?.id || 'unknown', ip };
}

/**
 * 存储配置（系统管理页面用）。
 *
 * 三个动作分权：
 * - 读配置 / 校验 / 保存 → `settings:view` / `settings:edit`
 * - **列服务器目录 → `storage:browse`（仅 super_admin）**，见 design §1.5
 *
 * 「保存成功」不等于「已生效」：消费服务只在**启动时**读配置（design §1.2 已定），
 * 因此保存接口显式返回 `restartRequired: true`，前端必须提示重启。
 *
 * 两个目录、两个消费服务：
 * - 上传根目录 → upload-service；
 * - 临时图目录 → ai-service（变变 AI 图等中间产物，W4 接入）。
 *
 * 加一项**判据**（R1）：允许根白名单 `storage.allowed_roots` —— 它是「哪些目录合法」
 * 的基准，原先散在各服务的 `.env` 里（漂移源），现收归配置表，随上面两项一起维护。
 */
@ApiTags('存储配置')
@Controller('admin/settings/storage')
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly logsService: OperationLogsService,
  ) {}

  @Get()
  @RequirePermission('settings:view')
  @ApiOperation({ summary: '读取存储配置（权威值 + 当前生效值 + 来源）' })
  async getConfig(@Req() req: Request) {
    const configured = await this.storage.resolveConfiguredUploadDir();
    const temp = await this.storage.resolveConfiguredTempDir();
    // 当前生效值：由本服务代问 upload-service（前端不持内部密钥、不直连内部接口）。
    // 取不到就是 null —— 页面降级为「只展示权威值 + 重启提示」，不影响读配置。
    const effective = await this.storage.fetchEffectiveUploadDir();
    const allowed = await this.storage.resolveConfiguredAllowedRoots();
    return {
      code: 0,
      data: {
        /** 权威配置值（upload-service 下次启动会采纳它）＝「待生效目录」 */
        uploadDir: configured.path,
        /** 这个值从哪来：system_configs / env / default */
        source: configured.source,
        /** 临时图目录权威值（ai-service 下次启动会采纳它） */
        tempDir: temp.path,
        tempSource: temp.source,
        /** 是否显式配过：false 表示用的是派生默认值，会随上传根目录变化 */
        tempConfigured: temp.configured,
        /** 派生默认值（页面「使用默认目录」按钮填它）：`<上传根目录的同级>/temp-images` */
        defaultTempDir: path.join(path.dirname(configured.path), TEMP_DIR_SEGMENT),
        /** 环境变量是否在兜底（展示用，避免运维误以为「改了配置中心却没生效」） */
        tempEnvOverride: Boolean((process.env[STORAGE_TEMP_DIR_ENV] || '').trim()),
        /** upload-service **本进程实际生效**的目录（内存值）；取不到为 null ＝「当前生效目录」 */
        effectivePath: effective?.path ?? null,
        effectiveSource: effective?.source ?? null,
        effectiveStartedAt: effective?.startedAt ?? null,
        browseEnabled: await this.storage.isBrowseEnabled(),
        /**
         * 当前用户能否浏览服务器目录（`storage:browse`，仅 super_admin）。
         *
         * 为什么由后端算：控制台的登录态只带单一 `role`，前端拿不到权限码集合；
         * 让前端自己判断角色字符串会把「谁能浏览」的口径复制一份出去（易漂移）。
         */
        canBrowse: hasPermission(req, 'storage:browse'),
        defaultDir: DEFAULT_UPLOAD_DIR,
        /** 环境变量是否在兜底（展示用，避免运维误以为「改了配置中心却没生效」） */
        envOverride: Boolean((process.env[STORAGE_UPLOAD_DIR_ENV] || '').trim()),
        /** 当前生效的允许根（目录越界校验的基准；家目录恒定在列） */
        allowedRoots: allowed.roots,
        /** 允许根从哪来：system_configs（页面改过）/ env（system-service 的环境变量在兜底）/ default */
        allowedRootsSource: allowed.source,
        /** 环境变量是否在兜底（展示用：页面改了配置却不生效时，多半是它在兜底） */
        allowedRootsEnvOverride: Boolean((process.env[STORAGE_ALLOWED_ROOTS_ENV] || '').trim()),
        restartHint:
          '保存后需重启：上传目录→upload-service、临时图目录→ai-service、允许根→所有消费服务（重启生效，不做热切换）',
      },
    };
  }

  @Put()
  @RequirePermission('settings:edit')
  @ApiOperation({ summary: '保存存储目录（写前校验，不存在则创建）' })
  async save(@Body() dto: StorageDirDto, @Req() req: Request) {
    const beforeUpload = await this.storage.resolveConfiguredUploadDir();
    const beforeTemp = await this.storage.resolveConfiguredTempDir();
    const wantTemp = dto.tempDir?.trim() || '';
    const wantRoots = dto.allowedRoots?.trim() || '';

    // 先**全部校验通过**再落库（design §1.4 方案 A）：
    // 否则会出现「上传目录已改、临时图目录校验失败被拒」的半改状态。
    const check = await this.storage.checkStorageDir(dto.uploadDir, { create: true });
    if (!check.ok || !check.resolvedPath) {
      throw new BadRequestException({
        code: check.code ?? 'UPLOAD_DIR_INVALID',
        message: check.message,
        data: check,
      });
    }
    let tempCheck: Awaited<ReturnType<StorageService['checkStorageDir']>> | undefined;
    if (wantTemp) {
      tempCheck = await this.storage.checkStorageDir(wantTemp, { create: true });
      if (!tempCheck.ok || !tempCheck.resolvedPath) {
        throw new BadRequestException({
          code: tempCheck.code ?? 'TEMP_DIR_INVALID',
          message: tempCheck.message,
          data: tempCheck,
        });
      }
    }

    /**
     * 允许根先**校验**（与目录一样，先全校验再落库）：
     * 它必须仍覆盖保存后会生效的目录 —— 否则下次启动这些目录被判越界，服务起不来。
     * 注意：放宽允许根与搬迁目录不能同一次完成（新目录要先在旧允许根内才校验得过），
     * 必须「先放宽 → 重启 → 再搬迁」，这也是报错文案给出的路径。
     */
    let rootsCheck: Awaited<ReturnType<StorageService['checkAllowedRoots']>> | undefined;
    if (wantRoots) {
      rootsCheck = await this.storage.checkAllowedRoots(wantRoots, [
        check.resolvedPath,
        ...(tempCheck?.resolvedPath ? [tempCheck.resolvedPath] : []),
        // 本次没提交 tempDir 时，已配置的临时图目录仍在生效（派生默认会随 uploads 变）
        ...(!tempCheck?.resolvedPath && beforeTemp.configured ? [beforeTemp.path] : []),
      ]);
      if (!rootsCheck.ok) {
        throw new BadRequestException({
          code: rootsCheck.code ?? 'ALLOWED_ROOTS_INVALID',
          message: rootsCheck.message,
          data: rootsCheck,
        });
      }
    }

    await this.storage.setUploadDir(check.resolvedPath);
    const changes = [`上传根目录 ${beforeUpload.path} → ${check.resolvedPath}`];
    if (tempCheck?.resolvedPath) {
      await this.storage.setTempDir(tempCheck.resolvedPath);
      changes.push(`临时图目录 ${beforeTemp.path} → ${tempCheck.resolvedPath}`);
    }
    if (rootsCheck?.ok) {
      await this.storage.setAllowedRoots(rootsCheck.roots);
      changes.push(`允许根白名单 → ${rootsCheck.roots.join('、')}`);
    }

    const { operator, ip } = auditContext(req);
    await this.logsService.log({
      operator,
      type: 'update_storage_dir',
      target: changes.join('；'),
      ip,
    });

    return {
      code: 0,
      data: {
        uploadDir: check.resolvedPath,
        previousDir: beforeUpload.path,
        check,
        /** 未提交 tempDir（省略/空串）时不返回这两个字段：表示「未改动」 */
        ...(tempCheck?.resolvedPath
          ? {
              tempDir: tempCheck.resolvedPath,
              previousTempDir: beforeTemp.path,
              tempCheck,
            }
          : {}),
        /** 未提交 allowedRoots 时不返回：表示「未改动」 */
        ...(rootsCheck?.ok ? { allowedRoots: rootsCheck.roots.join(',') } : {}),
        /** 关键语义：已保存，但消费服务重启后才生效 */
        restartRequired: true,
        message: tempCheck
          ? '已保存，将在 upload-service / ai-service 重启后生效'
          : '已保存，将在 upload-service 重启后生效',
      },
    };
  }

  @Post('validate')
  @RequirePermission('settings:edit')
  @ApiOperation({ summary: '校验存储目录（只校验，不保存、不创建）' })
  async validate(@Body() dto: StorageDirDto) {
    const upload = await this.storage.checkStorageDir(dto.uploadDir, { create: false });
    const wantTemp = dto.tempDir?.trim() || '';
    return {
      code: 0,
      data: {
        ...upload,
        /** 带了 tempDir 才返回它的校验结果（形状与上传目录一致，前端可复用同一套展示） */
        ...(wantTemp
          ? { tempDir: await this.storage.checkStorageDir(wantTemp, { create: false }) }
          : {}),
      },
    };
  }

  @Get('browse')
  @RequirePermission('storage:browse')
  @ApiOperation({ summary: '列出允许根内的目录（只列目录；仅 super_admin）' })
  async browse(@Query('path') queryPath: string | undefined, @Req() req: Request) {
    const result = await this.storage.browse(queryPath);
    // 每次浏览都留痕（design §1.5 审计约束）：便于事后追溯「谁看过哪些目录」
    const { operator, ip } = auditContext(req);
    await this.logsService.log({
      operator,
      type: 'view_storage_tree',
      target: result.path,
      ip,
    });
    return { code: 0, data: result };
  }
}
