import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { AuthModule } from './auth/auth.module';
import { ConfigModule as AppConfigModule } from './config/config.module';
import { DeployModule } from './deploy/deploy.module';
import { MonitorModule } from './monitor/monitor.module';
import { AuditModule } from './audit/audit.module';
import { EnvironmentModule } from './environment/environment.module';

@Module({
  imports: [
    // 全局配置模块
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // MySQL 数据库连接（腾讯云/本机，凭据见 .env 的 MYSQL_*）
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'mysql',
        host: cfg.get('MYSQL_HOST'),
        port: Number(cfg.get('MYSQL_PORT') || 3306),
        username: cfg.get('MYSQL_USER'),
        password: cfg.get('MYSQL_PASSWORD'),
        database: cfg.get('MYSQL_DB'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: true, // 开发/本地运维工具：自动建表。生产应改用 migration。
        charset: 'utf8mb4',
        timezone: 'local',
        namingStrategy: new SnakeNamingStrategy(),
      }),
    }),
    // 静态文件服务：serve apps/deploy-console/dist（monorepo 前端），排除 /api 路由
    ServeStaticModule.forRoot({
      rootPath:
        process.env.SERVE_ROOT ||
        join(__dirname, '..', '..', '..', 'apps', 'deploy-console', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    // 业务模块
    AuthModule,
    AppConfigModule,
    DeployModule,
    MonitorModule,
    AuditModule,
    EnvironmentModule,
  ],
})
export class AppModule {}
