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
import { LhbRecordEntity } from './entities/lhb-record.entity';
import { HotmoneySeatEntity } from './entities/hotmoney-seat.entity';
import { CollectRunEntity } from './entities/collect-run.entity';
import { CollectLogService } from './services/collect-log.service';
import { SeatTagService } from './services/seat-tag.service';
import { FinnewsAdapterService } from './services/finnews-adapter.service';
import { ArxivDigestService } from './services/arxiv-digest.service';
import { ContentQualityController } from './content-quality.controller';
import { ContentAuthModule } from '../auth/auth.module';

/** 内容管道领域模块——论文 / AI 资讯的采集、处理、发布 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContentSourceEntity,
      ContentPipelineEntity,
      ContentItemEntity,
      ContentPublicationEntity,
      ContentMediaEntity,
      LhbRecordEntity,
      HotmoneySeatEntity,
      CollectRunEntity,
    ]),
    ContentAuthModule,
  ],
  controllers: [ContentController, ContentQualityController],
  providers: [
    ContentService,
    PipelineService,
    SchedulerService,
    TencentDocsPublisher,
    WechatMpPublisher,
    CollectLogService,
    SeatTagService,
    FinnewsAdapterService,
    ArxivDigestService,
  ],
  exports: [
    ContentService,
    PipelineService,
    CollectLogService,
    SeatTagService,
    FinnewsAdapterService,
    ArxivDigestService,
  ],
})
export class ContentModule {}
