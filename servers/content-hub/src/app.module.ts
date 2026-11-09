import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import * as path from 'path';
import {
  SnakeNamingStrategy,
  DB_TARGET_ALLOWLIST_ENV,
  resolveDbTarget,
} from '@web-system/shared';
import { FinnewsModule } from './finnews.module';
import { ContentModule } from './content/content.module';
import { InstitutionModule } from './institution/institution.module';
import { HealthModule } from './health/health.module';
import { TopicEntity } from './entities/topic.entity';
import { NewsEntity } from './entities/news.entity';
import { EntityEntity } from './entities/entity.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { ContentSourceEntity } from './content/entities/content-source.entity';
import { ContentPipelineEntity } from './content/entities/content-pipeline.entity';
import { ContentItemEntity } from './content/entities/content-item.entity';
import { ContentPublicationEntity } from './content/entities/content-publication.entity';
import { ContentMediaEntity } from './content/entities/content-media.entity';
import { LhbRecordEntity } from './content/entities/lhb-record.entity';
import { HotmoneySeatEntity } from './content/entities/hotmoney-seat.entity';
import { CollectRunEntity } from './content/entities/collect-run.entity';
import { PipelineRunEntity } from './content/entities/pipeline-run.entity';
import { ContentAccountEntity } from './content/entities/content-account.entity';
import { NceLessonEntity } from './content/entities/nce-lesson.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [ path.resolve(__dirname, '../.env.generated'),path.resolve(__dirname, '../.env')],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get('DB_TYPE', 'mysql');
        // 启动守卫：DB_DATABASE 白名单 fail fast；synchronize 只允许白名单主库 + 非 production。
        // 2026-10-26 曾因误连 deploy/shadow 且开着 synchronize，在两库建出空壳 content_* 表。
        const dbTarget = resolveDbTarget({
          database: configService.get<string>('DB_DATABASE'),
          nodeEnv: configService.get<string>('NODE_ENV'),
          allowlist: configService.get<string>(DB_TARGET_ALLOWLIST_ENV),
        });
        const entities = [
          TopicEntity,
          NewsEntity,
          EntityEntity,
          SubscriptionEntity,
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
        ];
        if (dbType === 'mysql') {
          return {
            type: 'mysql' as const,
            host: configService.get<string>('DB_HOST', 'localhost'),
            port: configService.get<number>('DB_PORT', 3306),
            username: configService.get<string>('DB_USERNAME', 'root'),
            password: configService.get<string>('DB_PASSWORD', ''),
            database: dbTarget.database,
            entities,
            synchronize: dbTarget.synchronize,
            namingStrategy: new SnakeNamingStrategy(),
            charset: 'utf8mb4',
          };
        }
        return {
          type: 'postgres' as const,
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'web_system'),
          password: configService.get<string>('DB_PASSWORD', ''),
          database: dbTarget.database,
          entities,
          synchronize: dbTarget.synchronize,
        };
      },
    }),
    FinnewsModule,
    ContentModule,
    InstitutionModule,
    HealthModule,
  ],
})
export class AppModule {}
