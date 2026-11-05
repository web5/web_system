import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'path';
import {
  SnakeNamingStrategy,
  DB_TARGET_ALLOWLIST_ENV,
  resolveDbTarget,
} from '@web-system/shared';
import { McpModule } from './mcp/mcp.module';
import { HealthModule } from './health/health.module';
import { McpModuleEntity } from './mcp/entities/mcp-module.entity';
import { McpToolEntity } from './mcp/entities/mcp-tool.entity';
import { McpJobEntity } from './mcp/entities/mcp-job.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [ path.resolve(__dirname, '../.env.generated'),path.resolve(__dirname, '../.env')],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get('DB_TYPE', 'mysql');
        // 启动守卫（与 content-hub 共用 @web-system/shared 唯一实现）：
        // DB_DATABASE 白名单 fail fast；synchronize 只允许白名单主库 + 非 production。
        // 2026-10-26 曾因「误连 + synchronize」在 deploy/shadow 建出空壳表。
        const dbTarget = resolveDbTarget({
          database: configService.get<string>('DB_DATABASE'),
          nodeEnv: configService.get<string>('NODE_ENV'),
          allowlist: configService.get<string>(DB_TARGET_ALLOWLIST_ENV),
        });
        const entities = [McpModuleEntity, McpToolEntity, McpJobEntity];
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
    McpModule,
    HealthModule,
  ],
})
export class AppModule {}
