import { createRequire } from 'node:module';
const require = createRequire('/Users/geekwen/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');
const DIR = '/Users/geekwen/workspace1/web_system/apps/kedou-ai-minigram/prototype';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-proxy-server', '--hide-scrollbars'] });
const p = await b.newPage();
const errs = []; p.on('pageerror', e => errs.push(String(e)));
await p.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 });
await p.goto(`file://${DIR}/index.html`, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1000));

await p.evaluate(() => { enterTab('discover'); });
await new Promise(r => setTimeout(r, 400));
await p.evaluate(() => { navigateTo('p-translate'); });
await new Promise(r => setTimeout(r, 400));
await p.evaluate(() => { const i = document.getElementById('inp'); if (i) i.value = '我们无法决定风的方向，但可以调整帆的角度。'; doTranslate(); });
await new Promise(r => setTimeout(r, 4500));

const info = await p.evaluate(() => {
  const el = document.getElementById('p-tr-result');
  const r = el.querySelector('.res');
  const cs = r ? getComputedStyle(r) : null;
  return { border: cs ? cs.borderLeftWidth : '-', shadow: cs ? (cs.boxShadow || 'none').slice(0, 46) : '-' };
});
console.log('.res  borderLeftWidth =', info.border, '| boxShadow =', info.shadow);

const phone = await p.$('.phone');
await phone.screenshot({ path: `${DIR}/预览-翻译结果.png` });
await p.evaluate(() => { document.body.dataset.theme = 'dark'; });
await new Promise(r => setTimeout(r, 500));
await phone.screenshot({ path: `${DIR}/预览-翻译结果-暗色.png` });
console.log('页面错误:', errs.length, errs.slice(0, 2).join(' | '));
await b.close();
