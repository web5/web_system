import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import * as path from 'path';
import { AiModule } from './ai/ai.module';
import { ConversationModule } from './conversation/conversation.module';
import { BianbianModule } from './bianbian/bianbian.module';
import { ArtworksModule } from './artworks/artworks.module';
import { TtsModule } from './tts/tts.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // 配置模块
    // 注意：PM2 启动时 cwd 是项目根（不是本服务子目录），所以相对路径 '.env' 找不到
    // 用 path.resolve(__dirname, '../.env') 同时支持 dist 和 src 运行（两者 __dirname 都在 servers/<svc>/dist 或 /src，../.env 都能定位到正确位置）
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(__dirname, '../.env'),   // servers/ai-service/.env（兼容 dist/src 运行）
      ],
    }),

    // 数据库模块（支持 MySQL 和 PostgreSQL）
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get('DB_TYPE', 'postgres');
        if (dbType === 'mysql') {
          return {
            type: 'mysql',
            host: configService.get('DB_HOST', 'localhost'),
            port: configService.get<number>('DB_PORT', 3306),
            username: configService.get('DB_USERNAME', 'root'),
            password: configService.get('DB_PASSWORD', ''),
            database: configService.get('DB_DATABASE', 'web_system'),
            entities: [__dirname + '/**/*.entity{.ts,.js}'],
            extra: {
              connectionLimit: 20,
              connectTimeout: 10000,
              waitForConnections: true,
            },
            synchronize: configService.get('NODE_ENV') !== 'production',
            logging: configService.get('NODE_ENV') === 'development',
          };
        }
        const databaseUrl = configService.get('DATABASE_URL');
        if (databaseUrl) {
          return {
            type: 'postgres',
            url: databaseUrl,
            entities: [__dirname + '/**/*.entity{.ts,.js}'],
            extra: {
              max: 20,
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 5000,
            },
            synchronize: configService.get('NODE_ENV') !== 'production',
            logging: configService.get('NODE_ENV') === 'development',
          };
        }
        return {
          type: 'postgres',
          host: configService.get('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get('DB_USERNAME', 'web_system'),
          password: configService.get('DB_PASSWORD', ''),
          database: configService.get('DB_DATABASE', 'web_system'),
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          extra: {
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
          },
          synchronize: configService.get('NODE_ENV') !== 'production',
          logging: configService.get('NODE_ENV') === 'development',
        };
      },
      inject: [ConfigService],
    }),

    // 认证模块
    AuthModule,

    // HTTP 模块（用于调用 Hy3 API）
    HttpModule,

    // 业务模块
    AiModule,
    ConversationModule,
    BianbianModule,
    ArtworksModule,
    TtsModule,
  ],
})
export class AppModule {}
