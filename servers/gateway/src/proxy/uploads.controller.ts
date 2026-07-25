import { Controller, All, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ProxyService } from './proxy.service';

/**
 * 上传文件静态资源代理 — 处理 /uploads/* 路径
 *
 * 注意：此 Controller 没有 @Controller('api') 前缀，
 * 直接匹配根路径下的 /uploads/*，将请求代理到 user-service。
 */
@ApiExcludeController()
@Controller()
export class UploadsController {
  constructor(private proxyService: ProxyService) {}

  @All('uploads/:path(*)')
  @All('uploads')
  proxyUploads(@Req() req: Request, @Res() res: Response) {
    // 复用 user-service 代理，pathRewrite 不匹配 /uploads，所以原样转发到 user-service
    const proxy = this.proxyService.createUserProxy();
    return proxy(req, res, () => {
      res.status(404).json({ code: 404, message: 'File not found' });
    });
  }
}
