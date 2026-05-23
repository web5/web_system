import { Controller, All, Get, Req, Res, Header } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SwaggerDocsService } from './swagger-docs.service';

@ApiTags('API 文档')
@Controller('swagger')
export class SwaggerDocsController {
  constructor(private swaggerDocsService: SwaggerDocsService) {}

  /** 文档聚合首页 - 分栏展示所有服务的 Swagger UI */
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getSwaggerIndex(@Req() req: Request, @Res() res: Response) {
    res.send(getSwaggerIndexHtml());
  }

  /** 代理 Auth 服务 Swagger */
  @All('auth')
  @ApiOperation({ summary: 'Auth Service Swagger UI' })
  proxyAuthDocs(@Req() req: Request, @Res() res: Response) {
    this.swaggerDocsService.createAuthDocsProxy()(req, res, () => {
      res.status(502).json({ message: 'Auth Service Swagger 不可达' });
    });
  }

  @All('auth/*')
  proxyAuthDocsAssets(@Req() req: Request, @Res() res: Response) {
    this.swaggerDocsService.createAuthDocsProxy()(req, res, () => {
      res.status(502).json({ message: 'Auth Service Swagger 资源不可达' });
    });
  }

  /** 代理 AI 服务 Swagger */
  @All('ai')
  @ApiOperation({ summary: 'AI Service Swagger UI' })
  proxyAiDocs(@Req() req: Request, @Res() res: Response) {
    this.swaggerDocsService.createAiDocsProxy()(req, res, () => {
      res.status(502).json({ message: 'AI Service Swagger 不可达' });
    });
  }

  @All('ai/*')
  proxyAiDocsAssets(@Req() req: Request, @Res() res: Response) {
    this.swaggerDocsService.createAiDocsProxy()(req, res, () => {
      res.status(502).json({ message: 'AI Service Swagger 资源不可达' });
    });
  }

  /** 代理 User 服务 Swagger */
  @All('user')
  @ApiOperation({ summary: 'User Service Swagger UI' })
  proxyUserDocs(@Req() req: Request, @Res() res: Response) {
    this.swaggerDocsService.createUserDocsProxy()(req, res, () => {
      res.status(502).json({ message: 'User Service Swagger 不可达' });
    });
  }

  @All('user/*')
  proxyUserDocsAssets(@Req() req: Request, @Res() res: Response) {
    this.swaggerDocsService.createUserDocsProxy()(req, res, () => {
      res.status(502).json({ message: 'User Service Swagger 资源不可达' });
    });
  }
}

/** Swagger 文档聚合页 HTML */
function getSwaggerIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API 文档 - 科豆 AI</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; height: 100vh; display: flex; flex-direction: column; }

  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  .header h1 { font-size: 20px; }
  .header a { color: rgba(255,255,255,0.85); font-size: 13px; text-decoration: none; border: 1px solid rgba(255,255,255,0.3); padding: 4px 12px; border-radius: 6px; }
  .header a:hover { background: rgba(255,255,255,0.15); }

  .tabs { display: flex; background: #fff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
  .tab { flex: 1; padding: 12px 16px; text-align: center; cursor: pointer; font-size: 14px; font-weight: 500; color: #6b7280; border-bottom: 2px solid transparent; transition: all 0.2s; }
  .tab:hover { color: #667eea; }
  .tab.active { color: #667eea; border-bottom-color: #667eea; }
  .tab-icon { font-size: 16px; margin-right: 4px; }

  .content { flex: 1; position: relative; }
  .pane { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: none; border: none; }
  .pane.active { display: block; }

  .footer { text-align: center; padding: 8px; font-size: 12px; color: #bbb; flex-shrink: 0; border-top: 1px solid #e5e7eb; background: #fff; }
  .footer a { color: #667eea; }
</style>
</head>
<body>

<div class="header">
  <h1>📚 API 文档中心</h1>
  <a href="/docs" target="_blank">Gateway Swagger →</a>
</div>

<div class="tabs">
  <div class="tab active" data-pane="auth"><span class="tab-icon">🔐</span>Auth Service</div>
  <div class="tab" data-pane="user"><span class="tab-icon">👤</span>User Service</div>
  <div class="tab" data-pane="ai"><span class="tab-icon">🤖</span>AI Service</div>
</div>

<div class="content">
  <iframe id="pane-auth" class="pane active" src="/swagger/auth"></iframe>
  <iframe id="pane-user" class="pane" src="/swagger/user"></iframe>
  <iframe id="pane-ai" class="pane" src="/swagger/ai"></iframe>
</div>

<div class="footer">
  科豆 AI 项目 · 接口文档 · 共 4 个服务
</div>

<script>
(function() {
  var tabs = document.querySelectorAll('.tab');
  var panes = document.querySelectorAll('.pane');

  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = this.dataset.pane;
      tabs.forEach(function(t) { t.classList.remove('active'); });
      panes.forEach(function(p) { p.classList.remove('active'); });
      this.classList.add('active');
      document.getElementById('pane-' + target).classList.add('active');
    });
  });

  // 监听 iframe 加载完成，尝试注入样式修复
  var iframes = document.querySelectorAll('iframe');
  iframes.forEach(function(iframe) {
    iframe.addEventListener('load', function() {
      try {
        var doc = iframe.contentDocument || iframe.contentWindow.document;
        if (doc) {
          // 隐藏顶部导航栏（避免在 iframe 中显得多余）
          var style = doc.createElement('style');
          style.textContent = '.topbar { display: none !important; }';
          doc.head.appendChild(style);
        }
      } catch(e) { /* 跨域限制，跳过 */ }
    });
  });
})();
</script>

</body>
</html>`;
}
