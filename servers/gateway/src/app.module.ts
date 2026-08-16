import { Module, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import * as path from 'path';
import { ProxyModule } from './proxy/proxy.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { StaticModule } from './static/static.module';
import { HealthModule } from './health/health.module';
import { MiniScanModule } from './mini-scan/mini-scan.module';
import { SwaggerDocsModule } from './swagger-docs/swagger-docs.module';
import { ApiDocsModule } from './api-docs/api-docs.module';
import { SnakeNamingStrategy } from '@web-system/shared';
import { GatewayRouteEntity } from './entities/gateway-route.entity';
import { GatewayAccessLogEntity } from './entities/gateway-access-log.entity';
import { DeployDeploymentEntity } from './deploy-version/deploy-deployment.entity';
import { DeployModuleEntity } from './deploy-version/deploy-module.entity';
import { DeployVersionModule } from './deploy-version/deploy-version.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(__dirname, '../.env'),   // servers/gateway/.env（兼容 dist/src 运行）
      ],
    }),
    // 网关自身元数据库（路由配置、访问日志）
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'mysql',
        host: cfg.get('MYSQL_HOST'),
        port: Number(cfg.get('MYSQL_PORT') || 3306),
        username: cfg.get('MYSQL_USER'),
        password: cfg.get('MYSQL_PASSWORD'),
        database: cfg.get('MYSQL_DB'),
        // 主库（web_system）只挂网关自身实体；deploy_* 镜像实体只属于下方 'deploy' 连接
        entities: [GatewayRouteEntity, GatewayAccessLogEntity],
        // 生产环境务必置 false，改用 migrations/ 下的迁移脚本
        synchronize: cfg.get('NODE_ENV') !== 'production',
        charset: 'utf8mb4',
        timezone: 'local',
        namingStrategy: new SnakeNamingStrategy(),
      }),
    }),
    // 全局限流：每 IP 每分钟最多 100 次请求
    ThrottlerModule.forRoot([{
      ttl: 60_000,       // 时间窗口 60 秒
      limit: 100,        // 窗口内最多 100 次请求
    }]),
    HealthModule,
    MiniScanModule,
    ProxyModule,
    AuthModule,
    StaticModule,
    SwaggerDocsModule,
    ApiDocsModule,
    TypeOrmModule.forFeature([GatewayRouteEntity, GatewayAccessLogEntity]),
    // 部署库（只读）：查询「某环境某模块」当前线上版本，供 index.html 版本注入/未来灰度使用
    TypeOrmModule.forRootAsync({
      name: 'deploy',
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'mysql',
        host: cfg.get('DEPLOY_DB_HOST', '127.0.0.1'),
        port: Number(cfg.get('DEPLOY_DB_PORT') || 3306),
        username: cfg.get('DEPLOY_DB_USER', 'root'),
        password: cfg.get('DEPLOY_DB_PASSWORD', 'KedouLocal@2026'),
        database: cfg.get('DEPLOY_DB_NAME', 'web_system_deploy'),
        entities: [DeployDeploymentEntity, DeployModuleEntity],
        // gateway 是只读消费者，绝不自动建表
        synchronize: false,
        charset: 'utf8mb4',
        timezone: 'local',
        namingStrategy: new SnakeNamingStrategy(),
      }),
    }),
    DeployVersionModule,
  ],
  providers: [
    // 重要：Guard 顺序决定了执行顺序，先全局鉴权再限流
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const jwtSecret = this.configService.get('JWT_SECRET', '');
    if (!jwtSecret || jwtSecret === 'change_me_in_dev') {
      this.logger.error(
        'JWT_SECRET 未设置或为默认值，将拒绝启动！请在 .env 中设置安全的 JWT_SECRET。',
      );
      process.exit(1);
    }
    this.logger.log('JWT_SECRET 校验通过');
  }
}
