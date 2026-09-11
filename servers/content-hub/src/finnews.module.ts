import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinnewsService } from './services/finnews.service';
import { FinnewsController } from './finnews.controller';
import { TopicEntity } from './entities/topic.entity';
import { NewsEntity } from './entities/news.entity';
import { EntityEntity } from './entities/entity.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { ContentModule } from './content/content.module';

/** 财经资讯微服务模块 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TopicEntity, NewsEntity, EntityEntity, SubscriptionEntity]),
    // 论文摘要发布复用内容管道的公众号建稿/发布能力
    ContentModule,
  ],
  controllers: [FinnewsController],
  providers: [FinnewsService],
  exports: [FinnewsService],
})
export class FinnewsModule {}
