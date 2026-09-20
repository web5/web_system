import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 原型预览图生成（本机跑）：node prototype/_shot-welcome.mjs
// CHROME_PATH 覆盖 Chrome 路径；PUPPETEER_CORE_ROOT 指定 puppeteer-core 解析根（项目未安装时）
const DIR = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const puppeteer = process.env.PUPPETEER_CORE_ROOT
  ? createRequire(join(process.env.PUPPETEER_CORE_ROOT, 'index.js'))('puppeteer-core')
  : require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const b = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-proxy-server', '--hide-scrollbars'],
});
const p = await b.newPage();
await p.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 });
await p.goto(`file://${DIR}/index.html`, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1200));

const phone = await p.$('.phone');
await phone.screenshot({ path: `${DIR}/预览-欢迎页.png` });
console.log('✓ 预览-欢迎页.png');

await p.evaluate(() => { document.body.dataset.theme = 'dark'; });
await new Promise(r => setTimeout(r, 500));
await phone.screenshot({ path: `${DIR}/预览-欢迎页-暗色.png` });
console.log('✓ 预览-欢迎页-暗色.png');

await b.close();
