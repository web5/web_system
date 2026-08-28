import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as path from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { AuthModule } from './auth/auth.module';
import { AgentModule } from './agent/agent.module';
import { OcrModule } from './ocr/ocr.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(__dirname, '../.env')],
    }),

    // 数据库模块：持久化 Agent 对话记忆（多轮追问上下文）
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): TypeOrmModuleOptions => {
        const dbType = configService.get('DB_TYPE', 'postgres');
        const base: TypeOrmModuleOptions = {
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          namingStrategy: new SnakeNamingStrategy(),
          logging: configService.get('NODE_ENV') === 'development',
          synchronize: configService.get('NODE_ENV') !== 'production',
        };
        if (dbType === 'mysql') {
          return {
            type: 'mysql',
            host: configService.get('DB_HOST', 'localhost'),
            port: configService.get<number>('DB_PORT', 3306),
            username: configService.get('DB_USERNAME', 'root'),
            password: configService.get<string>('DB_PASSWORD', ''),
            database: configService.get('DB_DATABASE', 'ai_agent'),
            ...base,
            extra: {
              connectionLimit: 20,
              connectTimeout: 10000,
              waitForConnections: true,
            },
          } as TypeOrmModuleOptions;
        }
        if (dbType === 'sqlite') {
          return {
            type: 'better-sqlite3',
            database: configService.get('DB_DATABASE', './data/ai-agent.db'),
            ...base,
            synchronize: true,
          } as TypeOrmModuleOptions;
        }
        // 默认 postgres
        return {
          type: 'postgres',
          host: configService.get('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get('DB_USERNAME', 'web_system'),
          password: configService.get<string>('DB_PASSWORD', ''),
          database: configService.get('DB_DATABASE', 'web_system'),
          ...base,
          extra: {
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
          },
        } as TypeOrmModuleOptions;
      },
    }),

    AuthModule,
    AgentModule,
    OcrModule,
    McpModule,
  ],
})
export class AppModule {}
