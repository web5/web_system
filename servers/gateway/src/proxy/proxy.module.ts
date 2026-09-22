import { Module } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { ProxyController } from './proxy.controller';
import { DynamicRouteModule } from '../dynamic-route/dynamic-route.module';
import { DeployVersionModule } from '../deploy-version/deploy-version.module';

@Module({
  // DB 驱动路由由本模块的兜底控制器调用（双域重构 P2，默认关闭）
  // DeployVersionModule：reload 端点要顺带清模块版本缓存（IndexHtmlService.clearVersionCache）
  imports: [DynamicRouteModule, DeployVersionModule],
  controllers: [ProxyController],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
