import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';

@SkipThrottle()
@Public() // 探活端点：负载均衡 / 流水线 verify / 本地 curl 均无 token，必须免鉴权
@Controller()
export class HealthController {
  /**
   * 心跳探活。同时挂在 `/health` 与 `/api/health`：
   * - `/health`：服务直连探活（流水线 verify 阶段按 pm2 PORT 直打）
   * - `/api/health`：经 nginx 反代后的对外探活（local.kedouai.com/api/health）
   *
   * 必须注册在 ProxyModule 的 `@All(':path(*)')` 兜底之前（app.module 中 HealthModule 在先），
   * 否则 `/api/health` 会被通配路由兜底成 `Unknown API route` 404。
   */
  @Get(['health', 'api/health'])
  heartbeat() {
    return {
      status: 'ok',
      service: 'gateway',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
