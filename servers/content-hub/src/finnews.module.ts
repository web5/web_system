import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinnewsService } from './services/finnews.service';
import { FinnewsController } from './finnews.controller';
import { TopicEntity } from './entities/topic.entity';
import { NewsEntity } from './entities/news.entity';
import { EntityEntity } from './entities/entity.entity';
import { SubscriptionEntity } from './entities/subscription.entity';

/** 财经资讯微服务模块 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TopicEntity, NewsEntity, EntityEntity, SubscriptionEntity]),
  ],
  controllers: [FinnewsController],
  providers: [FinnewsService],
  exports: [FinnewsService],
})
export class FinnewsModule {}
