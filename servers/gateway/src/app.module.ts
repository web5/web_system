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
import {
  SnakeNamingStrategy,
  missingRequiredServiceUrls,
  serviceUrlFailFastHint,
} from '@web-system/shared';
import { GatewayRouteEntity } from './entities/gateway-route.entity';
import { GatewayAccessLogEntity } from './entities/gateway-access-log.entity';
import { DeployDeploymentEntity } from './deploy-version/deploy-deployment.entity';
import { DeployModuleEntity } from './deploy-version/deploy-module.entity';
import { DeployCanaryRuleEntity } from './deploy-version/deploy-canary-rule.entity';
import { DeployVersionModule } from './deploy-version/deploy-version.module';
// 双域重构 P2：DB 驱动路由的只读实体（由 ProxyModule → DynamicRouteModule 使用）
import {
  DeployAppEntity,
  DeployAppEnvVersionEntity,
  DeployEndpointEntity,
  DeployEnvEntity,
  DeployServiceEntity,
  DeployServiceEnvEntity,
  DeployServiceRouteEntity,
  DeploySiteEntity,
} from './dynamic-route/entities';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        // 平台下发（配置中心 → .env.generated，由控制台「部署」写入；删文件即回退到 .env）
        // ⚠️ 必须排在 .env **之前**：@nestjs/config 先出现者优先
        //（见 specs/service-config-delivery/design.md §4.1）
        path.resolve(__dirname, '../.env.generated'),
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
        password: cfg.get('DEPLOY_DB_PASSWORD', ''),
        database: cfg.get('DEPLOY_DB_NAME', 'web_system_deploy'),
        entities: [
          DeployDeploymentEntity,
          DeployModuleEntity,
          DeployCanaryRuleEntity,
          // 双域重构 P2：转发规则 / 服务指向 / 接口清单 / 环境 / 站点（只读）
          DeployServiceRouteEntity,
          DeployServiceEnvEntity,
          DeployServiceEntity,
          DeployEndpointEntity,
          DeployEnvEntity,
          DeploySiteEntity,
          // 双域重构 P3：应用 / 应用×环境版本指针（manifest 的 envs/byEnv，只读）
          DeployAppEntity,
          DeployAppEnvVersionEntity,
        ],
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

    // 生产环境必需服务地址 fail-fast（specs/backend-consolidation §2.3 B4）：
    // dev/prod 的地址口径与本地不同（AUTH_SERVICE_URL：dev/prod=6001、本机=6101），
    // 静默走默认值会连错机器 —— 生产必须显式配，缺了直接拒绝启动。
    const missingServiceUrls = missingRequiredServiceUrls((key) =>
      this.configService.get<string>(key),
    );
    if (missingServiceUrls.length) {
      this.logger.error(serviceUrlFailFastHint(missingServiceUrls));
      process.exit(1);
    }
  }
}
