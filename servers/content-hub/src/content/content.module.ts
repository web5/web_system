import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentController } from './content.controller';
import { ContentService } from './services/content.service';
import { PipelineService } from './services/pipeline.service';
import { SchedulerService } from './scheduler.service';
import { TencentDocsPublisher } from './publishers/tencent-docs.publisher';
import { WechatMpPublisher } from './publishers/wechat-mp/wechat-mp.publisher';
import { ContentSourceEntity } from './entities/content-source.entity';
import { ContentPipelineEntity } from './entities/content-pipeline.entity';
import { ContentItemEntity } from './entities/content-item.entity';
import { ContentPublicationEntity } from './entities/content-publication.entity';
import { ContentMediaEntity } from './entities/content-media.entity';

/** 内容管道领域模块——论文 / AI 资讯的采集、处理、发布 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContentSourceEntity,
      ContentPipelineEntity,
      ContentItemEntity,
      ContentPublicationEntity,
      ContentMediaEntity,
    ]),
  ],
  controllers: [ContentController],
  providers: [
    ContentService,
    PipelineService,
    SchedulerService,
    TencentDocsPublisher,
    WechatMpPublisher,
  ],
  exports: [ContentService, PipelineService],
})
export class ContentModule {}
