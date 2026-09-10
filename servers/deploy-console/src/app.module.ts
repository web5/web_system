import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join, resolve } from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { AuthModule } from './auth/auth.module';
import { DeployModule } from './deploy/deploy.module';
import { MonitorModule } from './monitor/monitor.module';
import { AuditModule } from './audit/audit.module';
import { EnvironmentModule } from './environment/environment.module';
import { ModuleRegistryModule } from './module-registry/module-registry.module';
import { CanaryModule } from './canary/canary.module';
import { ServerModule } from './server/server.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { McpDeployModule } from './mcp/mcp.module';
import { MetricsModule } from './metrics/metrics.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';
import { PipelineTemplateModule } from './pipeline-template/pipeline-template.module';
import { PipelineStepCommandModule } from './pipeline-step-command/pipeline-step-command.module';
import { ToolCatalogModule } from './tool-catalog/tool-catalog.module';
import { ReleaseGitModule } from './git/release-git.module';
import { ReleaseHookModule } from './hook/release-hook.module';

@Module({
  imports: [
    // 全局配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      // 显式指定配置路径：统一读本服务目录 servers/deploy-console/.env
      // （不再依赖 cwd 的根 .env，避免换目录启动就读不到配置）
      envFilePath: [resolve(__dirname, '../.env')],
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
    DeployModule,
    MonitorModule,
    AuditModule,
    EnvironmentModule,
    ModuleRegistryModule,
    CanaryModule,
    ServerModule,
    // 发布流水线（控制台 /api/pipelines/* + MCP /api/mcp/* 共用同一引擎）
    PipelineModule,
    McpDeployModule,
    // 发布度量（成功率 / 时长 / 失败阶段分布 / 失败下钻）
    MetricsModule,
    // 系统设置（通知渠道等系统级配置，页面可维护）
    SystemSettingsModule,
    // 流水线模板（模板=流程定义 / 实例=一次发布）
    PipelineTemplateModule,
    // 流水线节点命令（R6 新真相源：流水线 × 节点 key）
    PipelineStepCommandModule,
    // 工具目录（service 内置执行器 / shell CLI 元数据）
    ToolCatalogModule,
    // 发布目录 git 工作区工具（含 BranchController = GET /modules/:key/branches）
    ReleaseGitModule,
    // CI/CD 发布触发（POST /api/hooks/release：HMAC 签名 + deliveryId 幂等）
    ReleaseHookModule,
  ],
})
export class AppModule {}
