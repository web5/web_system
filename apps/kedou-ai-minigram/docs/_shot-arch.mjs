import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 方案文档预览图生成（本机跑）：node docs/_shot-arch.mjs
// SHOT_HTML 指定源 HTML，SHOT_OUT 指定输出目录；CHROME_PATH / PUPPETEER_CORE_ROOT 同其它 _shot 脚本
const DIR = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const puppeteer = process.env.PUPPETEER_CORE_ROOT
  ? createRequire(join(process.env.PUPPETEER_CORE_ROOT, 'index.js'))('puppeteer-core')
  : require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.SHOT_OUT || DIR;
const F = process.env.SHOT_HTML || join(DIR, '多Agent意图路由-架构设计.html');
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-proxy-server', '--hide-scrollbars'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.setViewport({ width: 1000, height: 1200, deviceScaleFactor: 2 });
await p.goto('file://' + F, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 700));
console.log('页面错误:', errs.length, errs.slice(0, 3).join(' | '));
console.log('文档高度:', await p.evaluate(() => document.body.scrollHeight) + 'px');
await p.screenshot({ path: join(OUT, '多Agent路由架构-预览-首屏.png') });
await p.screenshot({ path: join(OUT, '多Agent路由架构-预览-全页.png'), fullPage: true });
console.log('✓ 截图完成');
await b.close();
