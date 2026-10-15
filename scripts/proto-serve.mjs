#!/usr/bin/env node
/**
 * 本地原型体验入口（唯一入口，替代已废弃的在线发布预览）
 *
 *   node scripts/proto-serve.mjs            # → http://127.0.0.1:5180/
 *   PORT=5280 node scripts/proto-serve.mjs  # 换端口
 *
 * 设计口径（写进 docs/api/contracts.md §11）：
 *   · 只绑 127.0.0.1，不对外暴露（原型含内部信息）
 *   · 根路径给**索引页**，不裸列目录 —— 入口只有一个，不会「判错入口」
 *   · 按文件 mtime 排序，**最近在改的那个排第一**，不用人工维护链接
 *   · 改完仓库里的原型文件，刷新即生效，无需任何「重新发布」
 *
 * 为什么不再用在线发布（workbuddy sites）：
 *   ① 会话内的 127.0.0.1 临时端口预览，会话结束即回收 → 留存/转发必打不开
 *   ② 在线发布是**发布时快照**，改仓库文件不会同步，每轮还要重新征得同意
 *   ③ 在线预览面板本身打不开（实测「暂时无法预览」）
 */
'use strict';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROTO_DIR = path.join(ROOT, 'docs/ui/prototypes');
const PORT = Number(process.env.PORT || 5180);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 从原型文件里抓 <title> 与一句说明（取 body 第一个注释块或 meta description） */
function readMeta(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const title = (raw.match(/<title>([^<]*)<\/title>/) || [, path.basename(file)])[1].trim();
  const desc = (raw.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [, ''])[1].trim();
  const st = fs.statSync(file);
  return { title, desc, mtime: st.mtime, size: st.size };
}

function listProtos() {
  return fs
    .readdirSync(PROTO_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => Object.assign({ file: f }, readMeta(path.join(PROTO_DIR, f))))
    .sort((a, b) => b.mtime - a.mtime); // 最近改的在前 → 排第一的就是「正在做的那份」
}

function fmtTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function indexPage() {
  const protos = listProtos();
  const rows = protos
    .map((p, i) => {
      const top = i === 0;
      return `<li class="p${top ? ' top' : ''}">
        <a href="/${encodeURIComponent(p.file)}">
          <span class="nm">${escapeHtml(p.title)}</span>
          ${top ? '<span class="badge">最近更新</span>' : ''}
          <span class="meta">${escapeHtml(p.file)} · ${fmtTime(p.mtime)} · ${(p.size / 1024).toFixed(0)} KB</span>
          ${p.desc ? `<span class="desc">${escapeHtml(p.desc)}</span>` : ''}
        </a>
      </li>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>原型体验入口 · web_system</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;background:#F7F7F8;color:#171717;
    font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue","Microsoft YaHei",sans-serif}
  .wrap{max-width:860px;margin:0 auto;padding:40px 24px 64px}
  h1{font-size:20px;font-weight:600;margin:0 0 4px}
  .sub{color:#6B7280;font-size:13px;margin:0 0 24px}
  .cmd{background:#0A0A0D;color:#E5E7EB;border-radius:8px;padding:12px 16px;
    font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin-bottom:28px;overflow-x:auto}
  .cmd b{color:#F97316;font-weight:600}
  ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .p a{display:flex;flex-direction:column;gap:2px;padding:12px 16px;background:#fff;border:1px solid #E5E7EB;
    border-radius:8px;text-decoration:none;color:inherit;transition:border-color .12s,box-shadow .12s}
  .p a:hover{border-color:#F97316;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .p.top a{border-color:#F97316;border-width:1.5px}
  .nm{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}
  .badge{font-size:11px;font-weight:500;color:#C2410C;background:#FFF7ED;border:1px solid #FED7AA;
    border-radius:4px;padding:0 6px;line-height:18px}
  .meta{font-size:12px;color:#6B7280}
  .desc{font-size:12.5px;color:#374151}
  .foot{margin-top:32px;padding-top:16px;border-top:1px dashed #E5E7EB;font-size:12px;color:#6B7280}
  .foot code{background:#F3F4F6;border-radius:3px;padding:1px 5px;font-size:11.5px}
</style>
</head>
<body>
<div class="wrap">
  <h1>原型体验入口</h1>
  <p class="sub">本地静态服务 · 只读 docs/ui/prototypes · 共 ${protos.length} 份原型（按最近修改排序）</p>
  <div class="cmd">启动：<b>node scripts/proto-serve.mjs</b> &nbsp;→&nbsp; http://127.0.0.1:${PORT}/</div>
  <ul>
${rows}
  </ul>
  <div class="foot">
    入口口径见 <code>docs/api/contracts.md</code> §11「本地原型体验入口」。<br>
    改完仓库原型文件后**刷新即生效**，不需要重新发布；此服务不再对外提供在线链接。
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  } catch {
    return send(res, 400, 'Bad Request', 'text/plain; charset=utf-8');
  }

  if (urlPath === '/' || urlPath === '/index.html') {
    return send(res, 200, indexPage(), MIME['.html']);
  }

  // 安全：只允许 PROTO_DIR 内的文件，拒绝路径穿越
  const target = path.resolve(PROTO_DIR, '.' + urlPath);
  if (target !== PROTO_DIR && !target.startsWith(PROTO_DIR + path.sep)) {
    return send(res, 403, '403 Forbidden', 'text/plain; charset=utf-8');
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      return send(
        res,
        404,
        `404 Not Found：${escapeHtml(urlPath)}\n\n可用入口：/ （原型索引）`,
        'text/plain; charset=utf-8',
      );
    }
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(target).pipe(res);
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    process.stderr.write(`端口 ${PORT} 已被占用 → 换端口重试：PORT=5280 node scripts/proto-serve.mjs\n`);
    try {
      const pid = execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
      if (pid) process.stderr.write(`占用者 PID：${pid}（确认是旧 proto-serve 可 kill 后重试）\n`);
    } catch { /* lsof 不在或查不到，忽略 */ }
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  const n = listProtos().length;
  process.stdout.write(`原型体验入口已就绪（本地，不对外）\n`);
  process.stdout.write(`  → http://${HOST}:${PORT}/\n`);
  process.stdout.write(`  ${n} 份原型，第一条 = 最近修改的那份\n`);
  process.stdout.write(`  停止：Ctrl+C（口径见 docs/api/contracts.md §11）\n`);
});
