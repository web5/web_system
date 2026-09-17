import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 原型预览图生成（本机跑）：node prototype/_shot-border.mjs
// CHROME_PATH 覆盖 Chrome 路径；PUPPETEER_CORE_ROOT 指定 puppeteer-core 解析根（项目未安装时）
const DIR = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const puppeteer = process.env.PUPPETEER_CORE_ROOT
  ? createRequire(join(process.env.PUPPETEER_CORE_ROOT, 'index.js'))('puppeteer-core')
  : require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const jobs = [
  { file: 'quote-border.html', out: '引言边框-总览.png' },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-proxy-server', '--force-device-scale-factor=2', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 2140, height: 1100, deviceScaleFactor: 2 });

  for (const j of jobs) {
    await page.goto(`file://${DIR}/${j.file}`, { waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 700));
    await page.screenshot({ path: `${DIR}/${j.out}`, fullPage: true });
    console.log('✓', j.out);
  }

  // 单个手机屏（只截元素，避免外围画布干扰）
  await page.setViewport({ width: 2140, height: 1100, deviceScaleFactor: 2 });
  await page.goto(`file://${DIR}/quote-border.html`, { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 700));
  const phones = await page.$$('.phone');
  const names = ['G0-现状', 'G1-去边框纯净卡', 'G2-发丝线无卡', 'G3-大引号无卡', 'G4-极细橙线无卡'];
  for (let i = 0; i < phones.length; i++) {
    await phones[i].screenshot({ path: `${DIR}/引言边框-${names[i]}.png` });
    console.log('✓', `引言边框-${names[i]}.png`);
  }

  await browser.close();
})();
