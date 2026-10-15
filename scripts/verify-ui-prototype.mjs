import { createRequire } from 'node:module';
const require = createRequire('/Users/geekwen/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

// 用法：node scripts/verify-ui-prototype.mjs <原型 html 绝对路径>
// 目的：原型不是「看着对」就算过 —— 交互语义（互斥裁剪 / 锁死 / 后端错误态 / 防重复）
//       必须真点一遍；首轮就出现过「代码看着对、浏览器跑起来不对」的 locked 顺序问题。
const FILE = 'file://' + (process.argv[2] || '/Users/geekwen/workspace/web_system-llm-tuning/docs/ui/prototypes/admin-agents.html');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1400 });
await page.goto(FILE, { waitUntil: 'load' });

const payload = () => page.$eval('#payloadView', (e) => e.textContent);
const thinkOn = () => page.$eval('#thinkSeg', (e) => e.querySelector('.on')?.dataset.think ?? null);
const clickSave = async () => {
  await page.click('#saveBtn');
  await new Promise((r) => setTimeout(r, 1300));
};
const toastText = () => page.$eval('#toastText', (e) => e.textContent);
const toastShown = () => page.$eval('#toast', (e) => !e.classList.contains('hidden'));

const out = [];
const rec = (name, actual, expect, ok) => out.push({ name, actual, expect, ok: ok ?? actual === expect });

// 场景 A：套用「分类」预设 → thinking 必须被锁死为 off
await page.select('#preset', 'cls');
await new Promise((r) => setTimeout(r, 200));
rec('A1 thinkSeg 选中态', await thinkOn(), 'off');
rec('A1 payload', await payload(), '{"temperature":0,"maxTokens":256,"thinking":{"type":"disabled"}}');
rec('A1 locked', await page.$eval('#thinkSeg', (e) => e.classList.contains('locked')), true);
// 锁死后用户再点「沿用默认」应无效
await page.click('#thinkSeg [data-think="inherit"]');
await new Promise((r) => setTimeout(r, 100));
rec('A2 锁死后点击无效', await thinkOn(), 'off');

// 场景 B：切到 Top P 后直接保存 → payload 不应带 temperature
await page.select('#preset', 'chat'); // 先换档解锁
await new Promise((r) => setTimeout(r, 200));
await page.click('[data-dr="gen-params-sampler"] [data-mode="topP"]');
await new Promise((r) => setTimeout(r, 100));
rec('B1 切换后 temperature 已清空', await page.$eval('#inTemp', (e) => e.value), '');
await clickSave();
rec('B2 payload 无 temperature', /"temperature"/.test(await payload()), false);

// 场景 C：非法 maxTokens → 由后端返回错误，非前端自造
await page.click('[data-dr="gen-params-sampler"] [data-mode="temperature"]');
await page.$eval('#inMax', (e) => { e.value = '99999'; e.dispatchEvent(new Event('input')); });
await clickSave();
rec('C1 toast 显示后端错误', await toastText(), '保存失败：输出上限须为 1–32768 的整数');
rec('C2 错误 toast 常驻', await toastShown(), true);
rec('C3 字段红边', await page.$eval('#ctrlMax', (e) => e.style.borderColor), 'var(--ws-danger)');
rec('C4 role=alert', await page.$eval('#toast', (e) => e.getAttribute('role')), 'alert');

// 场景 D：连点保存只提交一次（按钮 disabled 期间无效）
await page.$eval('#inMax', (e) => { e.value = '2048'; e.dispatchEvent(new Event('input')); });
// 捕获阶段计数（在主 handler 之前），disabled 后浏览器不再派发 click
await page.evaluate(() => { window.__n = 0; document.getElementById('saveBtn').addEventListener('click', () => { window.__n++; }, true); });
await page.click('#saveBtn');
await page.click('#saveBtn');
await new Promise((r) => setTimeout(r, 1300));
rec('D1 连点提交次数', await page.evaluate(() => window.__n), 1);

console.log(JSON.stringify(out, null, 1));
const fail = out.filter((o) => !o.ok);
console.log(fail.length ? `\n❌ 失败 ${fail.length} 项` : '\n✅ 全部通过');
await browser.close();
process.exit(fail.length ? 1 : 0);
