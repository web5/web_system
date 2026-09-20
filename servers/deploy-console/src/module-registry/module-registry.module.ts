import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployModuleEntity } from '../entities/deploy-module.entity';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployServiceEntity } from '../entities/deploy-service.entity';
import { ModuleRegistryService } from './module-registry.service';

/**
 * 模块注册表模块（**只读适配层**）。
 *
 * M9：旧 `/modules` 写 API（controller）与 `EnvironmentModule` 依赖已随前端模块管理页下线
 * 一并移除 —— 模块不再是运行环境的一等公民（环境独立归属于站点，粒子 new `deploy_envs`）。
 * 运行期只保留 `list/get`（数据源：services + apps，旧表兜底）供流水线取元数据。
 */
@Module({
  imports: [TypeOrmModule.forFeature([DeployModuleEntity, DeployAppEntity, DeployServiceEntity])],
  providers: [ModuleRegistryService],
  exports: [ModuleRegistryService],
})
export class ModuleRegistryModule {}
