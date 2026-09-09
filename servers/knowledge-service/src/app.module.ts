import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from '@web-system/shared';
import * as path from 'path';
import { AuthModule } from './auth/auth.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { KnowledgeCollectionEntity } from './knowledge/entities/knowledge-collection.entity';
import { KnowledgeDocEntity } from './knowledge/entities/knowledge-doc.entity';
import { KnowledgeChunkEntity } from './knowledge/entities/knowledge-chunk.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(__dirname, '../.env')],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USERNAME', 'root'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>('DB_DATABASE', 'web_system_knowledge'),
        entities: [KnowledgeCollectionEntity, KnowledgeDocEntity, KnowledgeChunkEntity],
        // 开发自动建表；生产建表/变更走仓库 migrations/*.sql（sync-schema.sh）
        synchronize: configService.get('NODE_ENV') !== 'production',
        namingStrategy: new SnakeNamingStrategy(),
        charset: 'utf8mb4',
        logging: configService.get('DB_LOGGING') === 'true',
      }),
    }),
    AuthModule,
    KnowledgeModule,
  ],
})
export class AppModule {}
