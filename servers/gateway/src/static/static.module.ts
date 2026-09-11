import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

/**
 * 静态资源 + SPA 回退。
 *
 * ⚠️ 两条硬约束（2026-09-11 事故后固化，勿轻易回退）：
 *
 * 1) SPA 回退只允许命中「无扩展名」的前端路由。
 *    ServeStaticModule 的 renderPath 默认是 '*'，等价于 `app.get('*', 渲染 index.html)`：
 *    任何未命中的 GET（**包括 *.js / *.css**）都会返回 200 + text/html。
 *    而浏览器对 `<script type="module">` 做严格 MIME 校验，拿到 HTML 直接拒绝执行 ——
 *    表现为「外壳不启动：白屏 + console 一条日志都没有」，极难定位。
 *    触发场景：发布新 shell 后，已打开的旧标签页仍引用被删掉的旧 hash 资源。
 *    收窄成 /^\/[^.]*$/ 后，缺文件会走后续 404（Network 面板直接可见）。
 *
 * 2) 强缓存只给「内容寻址」的资源。
 *    带 hash 的产物（走 Vite 的 assets/*）或带版本目录的模块产物（/static/modules/<key>/<version>/）
 *    内容变了路径就变，可以 immutable 一年；
 *    而 index.html / version.json 是**指针型**文件，必须能及时更新（否则版本标记会被缓存一年，
 *    "有新版本"提示永远滞后）。
 */
@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public'),
      /** 只对无扩展名路径渲染 index.html（前端路由交给基座处理，静态资源缺失则 404） */
      renderPath: /^\/[^.]*$/,
      serveStaticOptions: {
        index: ['index.html'],
        setHeaders: (res, filePath) => {
          if (isContentAddressed(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            // index.html / version.json / favicon 等：每次校验，保证部署后能拿到新资源路径
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
        etag: true,
        lastModified: true,
      },
    }),
  ],
})
export class StaticModule {}

/**
 * 是否内容寻址（内容变化 → 路径变化）→ 可以强缓存。
 * 覆盖：Vite 产物 assets/*、微前端模块产物 static/modules/<key>/<version>/、
 * 自建 CDN static/cdn/，以及文件名里带 8 位以上 hash 的静态资源。
 */
export function isContentAddressed(filePath: string): boolean {
  const p = String(filePath).replace(/\\/g, '/');
  if (/\/(dist\/)?assets\//.test(p)) return true;
  if (/\/static\/(modules|cdn)\//.test(p)) return true;
  return /\.[A-Za-z0-9_-]{8,}\.(js|mjs|css|woff2?|ttf|eot|png|jpe?g|svg|webp|gif|ico)$/i.test(p);
}
