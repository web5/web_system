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
 * 2) 强缓存只给「内容寻址」的资源（内容变 → 路径变）。
 *    - 带 hash 的产物：Vite 的 assets/*、模块分包 /static/modules/<key>/.../<name>.<hash>.js
 *      → 路径变则内容变，可以 immutable 一年；
 *    - 指针型 / 固定名文件：index.html、version.json、模块入口 index.js、模块样式 index.css、
 *      自建 CDN /static/cdn/*.js → **路径不变而内容会变**，必须 no-cache 走 ETag 校验。
 *
 *    ⚠️ 2026-09-11 事故（dev.kedouai.com/admin 在 Chrome 下白屏）根因即此：
 *    原先把整个 /static/modules/ 与 /static/cdn/ 判为内容寻址，固定名入口 index.js/index.css
 *    被设成 immutable —— 同一版本目录被重复投递覆盖后（uploadLocal 会先清空目标目录），
 *    浏览器永不重新拉取入口，仍引用已被删除的旧分包 → 动态 import 404 → 首屏导航失败且
 *    无任何日志（vue-router 生产构建静默吞掉导航错误）。判定务必按「路径是否随内容变化」，
 *    而不是按目录前缀。
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
 * 微前端模块的「固定名入口」：`/static/modules/<key>/<产品线>/<版本>/index.js|index.css`。
 * legacy 扁平布局（`/static/modules/<key>/<版本>/index.js`）同样命中（中间段用 * 吸收）。
 *
 * 为什么单列一条：入口/样式**文件名不含 hash**，内容却随每次构建变化 ——
 * 是典型的"指针型"资源，强缓存后永不更新（详见文件头注释 §2 的 2026-09-11 事故说明）。
 */
const MF_FIXED_ENTRY_RE = /\/static\/modules\/[^/]+\/(?:[^/]+\/)*index\.(?:js|css)$/i;

/**
 * 自建 CDN 目录（`/static/cdn/vue.js`、`antd.js` …）。文件名固定、无 hash 段，
 * 升级公共依赖后必须能更新，故同样按指针型处理。
 */
const CDN_DIR_RE = /\/static\/cdn\//;

/**
 * 是否内容寻址（内容变化 → 路径变化）→ 可以强缓存。
 * 覆盖：Vite 产物 assets/*、微前端模块的带 hash 分包、以及文件名里带 8 位以上 hash 的静态资源。
 */
export function isContentAddressed(filePath: string): boolean {
  const p = String(filePath).replace(/\\/g, '/');
  // 固定名入口 / 样式：路径不变而内容变 → 绝不能强缓存
  if (MF_FIXED_ENTRY_RE.test(p)) return false;
  // 自建 CDN：文件名固定 → 不能强缓存
  if (CDN_DIR_RE.test(p)) return false;
  if (/\/(dist\/)?assets\//.test(p)) return true;
  // 模块目录下剩下的即带 hash 的分包（main.<hash>.js / <View>.<hash>.js）
  if (/\/static\/modules\//.test(p)) return true;
  return /\.[A-Za-z0-9_-]{8,}\.(js|mjs|css|woff2?|ttf|eot|png|jpe?g|svg|webp|gif|ico)$/i.test(p);
}
