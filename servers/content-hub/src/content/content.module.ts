import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentController } from './content.controller';
import { ContentService } from './services/content.service';
import { PipelineService } from './services/pipeline.service';
import { SchedulerService } from './scheduler.service';
import { WechatMpPublisher } from './publishers/wechat-mp/wechat-mp.publisher';
import { ContentSourceEntity } from './entities/content-source.entity';
import { ContentAccountEntity } from './entities/content-account.entity';
import { ContentAccountService } from './services/content-account.service';
import { AccountCredentialService } from './services/account-credential.service';
import { ContentPipelineEntity } from './entities/content-pipeline.entity';
import { ContentItemEntity } from './entities/content-item.entity';
import { ContentPublicationEntity } from './entities/content-publication.entity';
import { ContentMediaEntity } from './entities/content-media.entity';
import { LhbRecordEntity } from './entities/lhb-record.entity';
import { HotmoneySeatEntity } from './entities/hotmoney-seat.entity';
import { CollectRunEntity } from './entities/collect-run.entity';
import { PipelineRunEntity } from './entities/pipeline-run.entity';
import { PipelineRunService } from './services/pipeline-run.service';
import { CollectLogService } from './services/collect-log.service';
import { SeatTagService } from './services/seat-tag.service';
import { FinnewsAdapterService } from './services/finnews-adapter.service';
import { ContentItemPersistService } from './services/content-item-persist.service';
import { ManualCollectService } from './services/manual-collect.service';
import { ArxivDigestService } from './services/arxiv-digest.service';
import { ContentQualityController } from './content-quality.controller';
import { MediaController } from './media.controller';
import { NceController } from './nce.controller';
import { NceLessonEntity } from './entities/nce-lesson.entity';
import { NceLessonService } from './services/nce-lesson.service';
import { MediaService } from './services/media.service';
import { CoverAiService } from './services/cover-ai.service';
import { UploadStoreClient } from './services/upload-store.client';
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
      ContentAccountEntity,
      PipelineRunEntity,
      NceLessonEntity,
    ]),
    ContentAuthModule,
  ],
  controllers: [ContentController, ContentQualityController, MediaController, NceController],
  providers: [
    ContentService,
    PipelineService,
    SchedulerService,
    WechatMpPublisher,
    ContentAccountService,
    AccountCredentialService,
    PipelineRunService,
    CollectLogService,
    SeatTagService,
    FinnewsAdapterService,
    ContentItemPersistService,
    ManualCollectService,
    ArxivDigestService,
    MediaService,
    CoverAiService,
    UploadStoreClient,
    NceLessonService,
  ],
  exports: [
    ContentService,
    PipelineService,
    CollectLogService,
    SeatTagService,
    FinnewsAdapterService,
    ArxivDigestService,
    MediaService,
  ],
})
export class ContentModule {}
