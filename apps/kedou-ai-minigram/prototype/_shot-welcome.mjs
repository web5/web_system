import { createRequire } from 'node:module';
const require = createRequire('/Users/geekwen/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');
const DIR = '/Users/geekwen/workspace1/web_system/apps/kedou-ai-minigram/prototype';

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
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
