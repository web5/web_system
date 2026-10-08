import { Module } from '@nestjs/common';
import { CloudDbService } from './cloud-db.service';
import { EnvSplitWriterService } from './env-split-writer.service';

/**
 * 云数据库镜像写模块（design.md §5 #2/#3）。
 *
 * 只被「写 prod 数据」的服务引入（当前：ReleaseRegistryModule）。
 * 未启用（DEPLOY_CLOUD_DB_ENABLED≠true）时全部调用走 skipped 分支，
 * 行为等同改造前的人工同步现状，可一键回退。
 */
@Module({
  providers: [CloudDbService, EnvSplitWriterService],
  exports: [CloudDbService, EnvSplitWriterService],
})
export class CloudDbModule {}
