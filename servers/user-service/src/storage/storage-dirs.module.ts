import { Global, Logger, Module } from '@nestjs/common';
import { resolveAndHoldStorageDirs, STORAGE_DIRS } from '@web-system/shared';
import type { ResolvedStorageDirs } from '@web-system/shared';

/**
 * 存储目录模块 —— user-service 只用上传根目录（`/uploads` 静态资源 + `uploads/avatars` 头像）。
 *
 * 不解析临时图目录：本服务不需要，硬解析等于把「temp 配置出问题」变成
 * 「用户服务起不来」的无谓耦合。
 *
 * 为什么是 `@Global()`：`main.ts` 的 `app.useStaticAssets()` 要在 `create()` 之后立刻
 * 取 `app.get(STORAGE_DIRS)`；头像上传的 Multer 目标目录在**装饰器求值期**就要定，
 * 只能读进程内持有者（`@web-system/shared` 的 `getUploadDir()`）。
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DIRS,
      useFactory: async (): Promise<ResolvedStorageDirs> => {
        const logger = new Logger('StorageDirs');
        try {
          const dirs = await resolveAndHoldStorageDirs({ env: process.env });
          dirs.notes.forEach((note, i) => (i === 0 ? logger.log(note) : logger.warn(note)));
          logger.log(
            `上传根目录: ${dirs.uploadDir}（来源 ${dirs.uploadSource}，形态 ${dirs.mode}）`,
          );
          return dirs;
        } catch (e) {
          logger.error(`上传根目录解析失败：${(e as Error).message}`);
          logger.error('无法决定上传根目录，拒绝启动（不做静默回落）');
          process.exit(1);
        }
      },
    },
  ],
  exports: [STORAGE_DIRS],
})
export class StorageDirsModule {}
