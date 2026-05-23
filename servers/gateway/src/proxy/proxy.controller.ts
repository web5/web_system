import { Controller, All, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ProxyService } from './proxy.service';

@Controller('api')
export class ProxyController {
  constructor(private proxyService: ProxyService) {}

  @All('auth/*')
  proxyAuth(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createAuthProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('users*')
  proxyUsers(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createUserProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('ai/*')
  proxyAi(@Req() req: Request, @Res() res: Response) {
    const proxy = this.proxyService.createAiProxy();
    return proxy(req, res, () => {
      res.status(500).json({ code: 500, message: 'Proxy error' });
    });
  }

  @All('*')
  proxyApi(@Req() req: Request, @Res() res: Response) {
    res.status(404).json({ code: 404, message: `Unknown API route: ${req.method} ${req.path}` });
  }
}
