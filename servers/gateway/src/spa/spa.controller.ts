import { Controller, Get, Req, Res } from '@nestjs/common';
import { join, extname } from 'path';
import { Request, Response } from 'express';

@Controller()
export class SpaController {
  @Get('*')
  getIndex(@Req() req: Request, @Res() res: Response) {
    const path = req.path;

    // 跳过 API、文档等后端路由
    if (path.startsWith('/api') || path.startsWith('/docs') || path.startsWith('/swagger')) {
      return res.status(404).send('Not Found');
    }

    // 跳过 admin 路由（由 StaticModule 托管）
    if (path.startsWith('/admin')) {
      return res.status(404).send('Not Found');
    }

    // 跳过有扩展名的静态资源请求（.js, .css, .png 等）
    // 这些应由 ServeStaticModule 处理
    if (extname(path)) {
      return res.status(404).send('Not Found');
    }

    // SPA 回退 - 为前端路由返回 index.html
    res.sendFile(join(__dirname, '..', '..', 'public', 'index.html'));
  }
}
