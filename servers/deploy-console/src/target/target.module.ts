import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployServiceEntity } from '../entities/deploy-service.entity';
import { TargetResolver } from './target-resolver.service';

/**
 * 跨域目标解析模块（双域重构 P0）
 *
 * 流水线执行器通过 `TargetResolver` 把 `moduleKey` / `targetRef` 解析成
 * `{ domain, key, repoDir, rootDir }`，替代散落各处的 `type === 'backend'` 判断。
 */
@Module({
  imports: [TypeOrmModule.forFeature([DeployAppEntity, DeployServiceEntity])],
  providers: [TargetResolver],
  exports: [TargetResolver],
})
export class TargetModule {}
