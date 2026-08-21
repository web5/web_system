import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import * as path from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { FinnewsModule } from './finnews.module';
import { ContentModule } from './content/content.module';
import { TopicEntity } from './entities/topic.entity';
import { NewsEntity } from './entities/news.entity';
import { EntityEntity } from './entities/entity.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { ContentSourceEntity } from './content/entities/content-source.entity';
import { ContentPipelineEntity } from './content/entities/content-pipeline.entity';
import { ContentItemEntity } from './content/entities/content-item.entity';
import { ContentPublicationEntity } from './content/entities/content-publication.entity';
import { ContentMediaEntity } from './content/entities/content-media.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(__dirname, '../.env')],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get('DB_TYPE', 'mysql');
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
        ];
        if (dbType === 'mysql') {
          return {
            type: 'mysql' as const,
            host: configService.get<string>('DB_HOST', 'localhost'),
            port: configService.get<number>('DB_PORT', 3306),
            username: configService.get<string>('DB_USERNAME', 'root'),
            password: configService.get<string>('DB_PASSWORD', ''),
            database: configService.get<string>('DB_DATABASE', 'web_system'),
            entities,
            synchronize: configService.get('NODE_ENV') !== 'production',
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
          database: configService.get<string>('DB_DATABASE', 'web_system'),
          entities,
          synchronize: configService.get('NODE_ENV') !== 'production',
        };
      },
    }),
    FinnewsModule,
    ContentModule,
  ],
})
export class AppModule {}
