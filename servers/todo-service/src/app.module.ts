import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { TodoModule } from './todo/todo.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // 配置模块（统一模式：先服务自己的 .env，再回退项目根 .env）
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        // 平台下发（配置中心 → .env.generated，流水线 restart 脚本落盘；删文件即回退到 .env）
        // ⚠️ 必须排在 .env 之前：@nestjs/config 先出现者优先
        path.resolve(__dirname, '../.env.generated'),
        path.resolve(__dirname, '../.env'),   // servers/todo-service/.env（兼容 dist/src 运行）
      ],
    }),

    // 认证模块
    AuthModule,

    // 数据库模块
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get('DB_TYPE', 'postgres');
        if (dbType === 'postgres') {
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
            namingStrategy: new SnakeNamingStrategy(),
            logging: configService.get('NODE_ENV') === 'development',
          };
        }
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
            namingStrategy: new SnakeNamingStrategy(),
            logging: configService.get('NODE_ENV') === 'development',
          };
        }
        return {
          type: 'better-sqlite3',
          database: configService.get('DB_DATABASE', './data/todo.db'),
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: true,
          namingStrategy: new SnakeNamingStrategy(),
          logging: configService.get('NODE_ENV') === 'development',
        };
      },
    }),

    // 功能模块
    TodoModule,
    HealthModule,
  ],
})
export class AppModule {}
