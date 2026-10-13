#!/usr/bin/env node
/**
 * SVG → PNG 光栅化（无头 Chrome）。用途：把原型稿里那颗 mic SVG 原样转成 WXSS 可用的位图，
 * 保证「原型 SVG」与「真机位图」像素级同源，杜绝 PIL 手工重画导致的形变差异。
 *
 * 用法：CHROME_PATH=... NODE_PATH=<puppeteer-core 所在> node scripts/svg2png.js <in.svg> <out.png> <size>
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function main() {
  const [inSvg, outPng, sizeRaw] = process.argv.slice(2);
  if (!inSvg || !outPng) throw new Error('用法: node scripts/svg2png.js <in.svg> <out.png> [size]');
  const size = parseInt(sizeRaw || '288', 10); // 288 = 96 的 3 倍，对应 @3x 位图
  const svg = fs.readFileSync(inSvg, 'utf8');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--user-data-dir=/tmp/pptr-svg2png-' + Date.now()],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;overflow:hidden}img{display:block;width:${size}px;height:${size}px}</style>` +
    `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`,
    { waitUntil: 'load' }
  );
  await page.screenshot({ path: outPng, omitBackground: true });
  await browser.close();
  console.log(`[svg2png] ${path.basename(inSvg)} → ${path.basename(outPng)} (${size}px, 透明底)`);
}

main().catch(e => { console.error('[svg2png] FAIL:', e.message); process.exit(1); });
