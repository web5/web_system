#!/usr/bin/env node
/**
 * tests/support/static-server.mjs — 无后端静态前端伺服（CI @smoke / 本地轻量验证用）
 *
 * 为什么存在（03 方案 §2.5）：PR 门禁 @smoke 只验「页面能开、资源完整」，
 * 不该依赖 gateway + MySQL 的全栈编排（那是独立 M 档工程）。本脚本把
 * portal / admin 的构建产物按 gateway 同款路径前缀挂出来：
 *
 *   /            → 302 /portal/
 *   /portal/*    → apps/portal/dist（SPA fallback 到 index.html）
 *   /admin/*     → apps/admin/dist（SPA fallback 到 index.html）
 *   其余（/api、/health 等）→ 502（提示该路径需要真后端）
 *
 * 用法：
 *   pnpm --filter @web-system/portal build && pnpm --filter @web-system/admin build
 *   node tests/support/static-server.mjs            # 默认 :8899
 *   node tests/support/static-server.mjs --port 9000
 *
 * 通常不直接起——playwright.config.ts 在 E2E_WEBSERVER=1 时通过 webServer 自起。
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT || 8899);

const MOUNTS = [
  { prefix: '/portal/', dir: path.join(ROOT, 'apps/portal/dist') },
  { prefix: '/admin/', dir: path.join(ROOT, 'apps/admin/dist') },
  // 公共静态资源：gateway 常态由 servers/gateway/public/static/cdn/pub/ 托管，
  // 唯一真源是 assets/shared-public/（scripts/build-public-assets.mjs 只是拷贝），
  // 静态伺服直接挂真源，省一次构建。
  { prefix: '/static/cdn/pub/', dir: path.join(ROOT, 'assets/shared-public') },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function serveFile(res, filePath) {
  try {
    const buf = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, buf, { 'content-type': MIME[ext] || 'application/octet-stream' });
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (url === '/' || url === '/portal') {
    send(res, 302, '', { location: '/portal/' });
    return;
  }

  for (const { prefix, dir } of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const rel = decodeURIComponent(url.slice(prefix.length));
    // 防目录穿越
    const filePath = path.normalize(path.join(dir, rel));
    if (!filePath.startsWith(dir)) {
      send(res, 403, 'forbidden');
      return;
    }
    if (await serveFile(res, filePath)) return;
    // SPA fallback：无扩展名路径回退 index.html（vue-router history 模式）
    if (!path.extname(rel)) {
      if (await serveFile(res, path.join(dir, 'index.html'))) return;
    }
    send(res, 404, `not found: ${url}`);
    return;
  }

  // /api /health 等后端路径：静态伺服给不了，显式 502 而不是 404 混淆
  send(res, 502, JSON.stringify({ error: 'static-server: 该路径需要真后端（gateway/服务），当前为无后端静态伺服' }), {
    'content-type': 'application/json; charset=utf-8',
  });
});

for (const { prefix, dir } of MOUNTS) {
  // /static/cdn/pub/ 挂的是真源目录，无 index.html，跳过产物检查
  if (prefix.startsWith('/static/')) continue;
  if (!existsSync(path.join(dir, 'index.html'))) {
    process.stderr.write(`[static-server] 缺少构建产物 ${dir}（先跑 pnpm --filter 对应包 build），挂载 ${prefix} 将 404\n`);
  }
}

server.listen(PORT, '127.0.0.1', () => {
  // 启动横幅是 CLI 的预期产出（产品行为，非调试残留），走 stdout 直写
  process.stdout.write(`[static-server] serving on http://127.0.0.1:${PORT}  (/portal/ /admin/)\n`);
});
