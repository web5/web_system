import { Module } from '@nestjs/common';
import { ProxyService } from './proxy.service';
import { ProxyController } from './proxy.controller';
import { DynamicRouteModule } from '../dynamic-route/dynamic-route.module';

@Module({
  // DB 驱动路由由本模块的兜底控制器调用（双域重构 P2，默认关闭）
  imports: [DynamicRouteModule],
  controllers: [ProxyController],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
