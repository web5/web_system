import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DeployEndpointEntity,
  DeployEnvEntity,
  DeployServiceEntity,
  DeployServiceEnvEntity,
  DeployServiceRouteEntity,
  DeploySiteEntity,
} from './entities';
import { DynamicRouteService } from './dynamic-route.service';

/**
 * DB 驱动路由模块（默认关闭，`GATEWAY_DB_ROUTES=1` 开启）。
 *
 * 无独立控制器：由 `ProxyController` 的最终 404 兜底分支调用
 * （单点兜底 = 无需操心路由注册顺序，且关闭时行为逐字节不变）。
 * 实体挂在已有的 `deploy` 命名连接（部署库 web_system_deploy，只读）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        DeployServiceRouteEntity,
        DeployServiceEnvEntity,
        DeployServiceEntity,
        DeployEndpointEntity,
        DeployEnvEntity,
        DeploySiteEntity,
      ],
      'deploy',
    ),
  ],
  providers: [DynamicRouteService],
  exports: [DynamicRouteService],
})
export class DynamicRouteModule {}
