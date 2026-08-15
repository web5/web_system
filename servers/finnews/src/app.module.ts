import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { FinnewsModule } from './finnews.module';
import { TopicEntity } from './entities/topic.entity';
import { NewsEntity } from './entities/news.entity';
import { EntityEntity } from './entities/entity.entity';
import { SubscriptionEntity } from './entities/subscription.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(__dirname, '../.env')],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get('DB_TYPE', 'mysql');
        const entities = [TopicEntity, NewsEntity, EntityEntity, SubscriptionEntity];
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
  ],
})
export class AppModule {}
