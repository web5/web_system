import { Global, Logger, Module } from '@nestjs/common';
import { resolveAndHoldStorageDirs, STORAGE_DIRS } from '@web-system/shared';
import type { ResolvedStorageDirs } from '@web-system/shared';

/**
 * 存储目录模块 —— ai-service 需要**两个**目录：上传根目录（静态资源 /uploads）
 * 与临时图目录（变变 AI 图的中间产物）。
 *
 * 为什么是 `@Global()`：`main.ts` 的 `app.useStaticAssets()` 要在 `create()` 之后
 * 立刻取 `app.get(STORAGE_DIRS)`，而 Bianbian 域在子模块里 —— 全局模块省掉
 * 逐层 import，同时**仍然只有一个 provider 实例**（目录对进程是常量）。
 *
 * fail-fast：解析不了就 `process.exit(1)`。宁可起不来，也不能把文件写到
 * `~/web_system/...` 这种与存量分裂的目录里（2026-11-03 实测 prod 曾有此风险）。
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_DIRS,
      useFactory: async (): Promise<ResolvedStorageDirs> => {
        const logger = new Logger('StorageDirs');
        try {
          // 形态分派 + 权威值解析（cluster 下 system-service 是唯一权威）
          const dirs = await resolveAndHoldStorageDirs({ withTempDir: true, env: process.env });
          // notes[0] 是形态判定依据（正常信息），其余是过程性说明（值得留意）
          dirs.notes.forEach((note, i) => (i === 0 ? logger.log(note) : logger.warn(note)));
          logger.log(
            `上传根目录: ${dirs.uploadDir}（来源 ${dirs.uploadSource}）；` +
              `临时图目录: ${dirs.tempDir}（来源 ${dirs.tempSource}）；形态 ${dirs.mode}`,
          );
          // 允许根是「越界」判定的基准 —— 目录被判越界时，先看的就应该是这一行
          logger.log(
            `允许根: ${dirs.allowedRoots.join('、')}（来源 ${dirs.allowedRootsSource}）`,
          );
          return dirs;
        } catch (e) {
          logger.error(`存储目录解析失败：${(e as Error).message}`);
          logger.error('无法决定数据目录，拒绝启动（不做静默回落）');
          process.exit(1);
        }
      },
    },
  ],
  exports: [STORAGE_DIRS],
})
export class StorageDirsModule {}
