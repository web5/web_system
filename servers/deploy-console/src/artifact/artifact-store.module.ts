import { Module } from '@nestjs/common';
import { ArtifactStoreService } from './artifact-store.service';

/**
 * 静态产物存储工具模块（upload/cleanup 内置步骤的执行体）。
 * 与 tool-catalog `deploy`/`cleanup` 分类的 service 工具对应，可被 pipeline 等模块复用。
 */
@Module({
  providers: [ArtifactStoreService],
  exports: [ArtifactStoreService],
})
export class ArtifactStoreModule {}
