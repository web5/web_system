import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicBaseUrlService } from '@web-system/shared';
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
  describePathError,
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

        // 形态分派 + 权威值解析。集群形态下拿不到权威值会**抛错**（不回落到单机路径），
        // 这里是 fail-fast 的唯一出口：解析不了目录就别起来，否则文件会写错地方。
        let resolved: Awaited<ReturnType<typeof resolveUploadDirAtStartup>>;
        try {
          resolved = await resolveUploadDirAtStartup({ env: process.env });
        } catch (e) {
          logger.error(`上传根目录解析失败：${describePathError(e)}`);
          logger.error('无法决定上传根目录，拒绝启动（不做静默回落）');
          process.exit(1);
        }
        // notes[0] 是形态判定依据（正常信息），其余是过程性说明（值得留意）
        resolved.notes.forEach((note, i) => (i === 0 ? logger.log(note) : logger.warn(note)));

        try {
          ensureWritableDir(resolved.dir);
        } catch (e) {
          logger.error((e as Error).message);
          logger.error('上传根目录不可用，拒绝启动（不做静默回落）');
          process.exit(1);
        }

        setUploadRoot(resolved.dir, resolved.source);
        logger.log(
          `上传根目录: ${resolved.dir}（来源 ${resolved.source}，形态 ${resolved.mode}）`,
        );
        return resolved.dir;
      },
    },
    UploadService,
    PublicBaseUrlService,
  ],
  exports: [UploadService],
})
export class UploadModule {}
