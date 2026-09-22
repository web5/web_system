import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadController } from './upload.controller';
import { InternalUploadsController } from './internal-uploads.controller';
import { UploadService } from './upload.service';
import { AuthModule } from '../auth/auth.module';
import { UploadFileEntity } from './upload-file.entity';
import { UPLOAD_ROOT } from './upload-root.token';
import { setUploadRoot } from './upload-root';
import {
  DEFAULT_UPLOAD_DIR,
  ensureWritableDir,
  resolveUploadDirAtStartup,
  STORAGE_UPLOAD_DIR_ENV,
} from '../storage/upload-dir';

/**
 * 上传域。
 *
 * `UPLOAD_ROOT` provider 是 A3 的核心：**启动期解析一次**上传根目录
 * （系统配置 → `STORAGE_UPLOAD_DIR` → `~/web_system/uploads`），做 ensureDir + 可写性探测，
 * 不可用就 `process.exit(1)`（fail-fast，不静默回落 cwd）；
 * 解析结果同时交给 DI（`UploadService`）与进程内持有者（Multer 装饰器用）。
 *
 * 语义是「重启生效」：运行期改系统配置不会切换目录，只有重启才会。
 */
@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([UploadFileEntity])],
  controllers: [UploadController, InternalUploadsController],
  providers: [
    {
      provide: UPLOAD_ROOT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<string> => {
        const logger = new Logger('UploadDir');

        // 旧键提醒：值还留在 .env 里但已不再生效 —— 不提醒的话，运维改它没反应会很难查
        const legacy = (config.get<string>('UPLOAD_DIR') || '').trim();
        if (legacy) {
          logger.warn(
            `检测到已弃用的 UPLOAD_DIR=${legacy}（已忽略）：上传根目录改为 ` +
              `系统配置 storage.upload_dir → ${STORAGE_UPLOAD_DIR_ENV} → ${DEFAULT_UPLOAD_DIR}`,
          );
        }

        const resolved = await resolveUploadDirAtStartup({ env: process.env });
        for (const note of resolved.notes) logger.warn(note);

        try {
          ensureWritableDir(resolved.dir);
        } catch (e) {
          logger.error((e as Error).message);
          logger.error('上传根目录不可用，拒绝启动（不做静默回落）');
          process.exit(1);
        }

        setUploadRoot(resolved.dir, resolved.source);
        logger.log(`上传根目录: ${resolved.dir}（来源 ${resolved.source}）`);
        return resolved.dir;
      },
    },
    UploadService,
  ],
  exports: [UploadService],
})
export class UploadModule {}
