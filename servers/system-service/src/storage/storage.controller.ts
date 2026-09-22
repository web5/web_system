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
import { RequirePermission } from '../auth/decorators';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { StorageDirDto } from './storage.dto';
import {
  DEFAULT_UPLOAD_DIR,
  StorageService,
  STORAGE_UPLOAD_DIR_ENV,
} from './storage.service';

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
 * 「保存成功」不等于「已生效」：upload-service 只在**启动时**读配置（design §1.2 已定），
 * 因此保存接口显式返回 `restartRequired: true`，前端必须提示重启。
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
  @ApiOperation({ summary: '读取存储配置（权威值 + 来源）' })
  async getConfig() {
    const configured = await this.storage.resolveConfiguredUploadDir();
    return {
      code: 0,
      data: {
        /** 权威配置值（upload-service 下次启动会采纳它） */
        uploadDir: configured.path,
        /** 这个值从哪来：system_configs / env / default */
        source: configured.source,
        browseEnabled: await this.storage.isBrowseEnabled(),
        defaultDir: DEFAULT_UPLOAD_DIR,
        /** 环境变量是否在兜底（展示用，避免运维误以为「改了配置中心却没生效」） */
        envOverride: Boolean((process.env[STORAGE_UPLOAD_DIR_ENV] || '').trim()),
        allowedRoots: this.storage.allowedRoots(),
        restartHint: '保存后需重启 upload-service 才切换目录（重启生效，不做热切换）',
      },
    };
  }

  @Put()
  @RequirePermission('settings:edit')
  @ApiOperation({ summary: '保存上传根目录（写前校验，不存在则创建）' })
  async save(@Body() dto: StorageDirDto, @Req() req: Request) {
    const before = await this.storage.resolveConfiguredUploadDir();
    const check = await this.storage.checkStorageDir(dto.uploadDir, { create: true });
    if (!check.ok || !check.resolvedPath) {
      // 校验不通过禁止保存（design §1.4 方案 A：校验是保存的前置门）
      throw new BadRequestException({
        code: check.code ?? 'UPLOAD_DIR_INVALID',
        message: check.message,
        data: check,
      });
    }

    await this.storage.setUploadDir(check.resolvedPath);
    const { operator, ip } = auditContext(req);
    await this.logsService.log({
      operator,
      type: 'update_storage_dir',
      target: `${before.path} → ${check.resolvedPath}`,
      ip,
    });

    return {
      code: 0,
      data: {
        uploadDir: check.resolvedPath,
        previousDir: before.path,
        check,
        /** 关键语义：已保存，但 upload-service 重启后才生效 */
        restartRequired: true,
        message: '已保存，将在 upload-service 重启后生效',
      },
    };
  }

  @Post('validate')
  @RequirePermission('settings:edit')
  @ApiOperation({ summary: '校验上传根目录（只校验，不保存、不创建）' })
  async validate(@Body() dto: StorageDirDto) {
    return {
      code: 0,
      data: await this.storage.checkStorageDir(dto.uploadDir, { create: false }),
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
