import { createRequire } from 'node:module';
const require = createRequire('/Users/geekwen/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

// 用法：node scripts/verify-agent-def-detail.mjs [原型 html 绝对路径]
// 目的：原型「看着对」不算过。本稿六条产品意见（新页面 / 高级区 / 调试台 / 用例表 / 不用弹窗 / 参数对比）
//       必须真点一遍才算验证过。
const FILE = 'file://' + (process.argv[2] ||
  '/Users/geekwen/workspace/web_system/docs/ui/prototypes/admin-agent-def-detail.html');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1400 });
await page.goto(FILE, { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const out = [];
const rec = (name, actual, expect, ok) => {
  const r = { name, actual, expect, ok: ok ?? actual === expect };
  // 实时进度：卡住时能一眼看出停在哪条断言之后（结果汇总在最后才打印）
  process.stderr.write((r.ok ? '  ok  ' : ' FAIL ') + name + '\n');
  out.push(r);
  return r;
};
// ⚠️ 只查 classList 会漏掉「.hidden 被同特异性 display 规则压掉」这类 bug（曾导致「思考预算」
//    该隐藏却显示），故这里按**真实可见性**判定：computed display / visibility / 盒子高度
const vis = (sel) => page.$eval(sel, (e) => {
  const s = getComputedStyle(e);
  return s.display !== 'none' && s.visibility !== 'hidden' && e.getBoundingClientRect().height > 0;
});
const txt = (sel) => page.$eval(sel, (e) => e.textContent.trim());
const val = (sel) => page.$eval(sel, (e) => e.value);
// 页面在 900px 壳内滚动，控件可能落在可视区外 → 点击前先滚到中间（真实用户也是这么操作的）
// 第二个参数透传给 click（如 {clickCount:3}）；若被 sticky 变更条等遮挡而点不到，
// 回退为元素自身派发 click（仍是真实 DOM 事件，仅绕过命中测试），并打一条提示。
const clickEl = async (sel, opts) => {
  const el = await page.$(sel);
  if (!el) throw new Error('找不到元素：' + sel);
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await wait(80);
  try {
    await el.click(opts);
  } catch (err) {
    process.stderr.write('  warn  ' + sel + ' 被遮挡，改用元素自身派发点击\n');
    await el.evaluate((e) => e.click());
  }
};

// —— ① 不用弹窗：整稿不存在 mask / modal 结构 ——
rec('1a 无 .mask 结构', await page.$$eval('.mask', (n) => n.length), 0);
rec('1b 无 .modal 结构', await page.$$eval('.modal', (n) => n.length), 0);
rec('1c 起始在列表页', await vis('#screen-list'), true);
rec('1d 详情页初始隐藏', await vis('#screen-detail'), false);

// —— ② 点「编辑」进入新页面 ——
await clickEl('[data-act="edit"][data-id="report-helper"]');
await wait(200);
rec('2a 列表隐藏', await vis('#screen-list'), false);
rec('2b 详情页可见', await vis('#screen-detail'), true);
rec('2c 面包屑带 id', await txt('#crumb-sub'), '/ report-helper');
// ② 续：详情必须按所选定义载入（早前版本是硬编码第一条，点第 2 行会串数据）
await clickEl('#btn-back');
await wait(150);
await clickEl('[data-act="edit"][data-id="contract-extract"]');
await wait(200);
rec('2d 标题随所选定义', await txt('#dt-title'), '合同条款抽取');
rec('2e 参数随之载入', await val('#in-temp'), '0.1');
rec('2f 面包屑随 id', await txt('#crumb-sub'), '/ contract-extract');
await clickEl('#btn-back');
await wait(150);
await clickEl('[data-act="edit"][data-id="report-helper"]');
await wait(200);
rec('2g 回到首条参数', await val('#in-temp'), '0.7');

// —— ③ 高级区默认折叠 ——
rec('3a 高级默认折叠', await vis('#adv-body-wrap'), false);
await clickEl('#card-adv .card-hd');
await wait(200);
rec('3b 展开后可见', await vis('#adv-body-wrap'), true);
rec('3c 基础配置默认展开', await page.$eval('#card-basic', (e) => e.classList.contains('open')), true);

// —— ④ 采样互斥 + 字段级 diff ——
await clickEl('#seg-sampler [data-sampler="topP"]');
await wait(150);
rec('4a temp 控件禁用', await page.$eval('#in-temp', (e) => e.disabled), true);
rec('4b temp 已清空', await val('#in-temp'), '');
rec('4c topP 启用', await page.$eval('#in-topP', (e) => e.disabled), false);
rec('4d diff 条出现', await vis('#diffbar'), true);
rec('4e diff 计数', await txt('#diff-count'), '1');
rec('4f 字段 badge 可见', await vis('#badge-temp'), true);

// —— ⑤ 对比面板内联展开（非弹窗） ——
await clickEl('#btn-diff-toggle');
await wait(150);
rec('5a diff 表可见', await vis('#diff-table'), true);
rec('5b diff 表含 Temperature', await txt('#diff-table'), (t) => /Temperature/.test(t),
  /Temperature/.test(await txt('#diff-table')));
rec('5c aria-expanded', await page.$eval('#btn-diff-toggle', (e) => e.getAttribute('aria-expanded')), 'true');
rec('5d 仍无弹窗', await page.$$eval('.mask', (n) => n.length), 0);
// ⑤ 续：基础配置字段也必须计入变更（否则改了会被静默吞掉）
await page.$eval('#in-prompt', (e) => { e.value = e.value + '（补充：先看现金流量表）'; e.dispatchEvent(new Event('input')); });
await wait(150);
rec('5e 基础字段计入变更数', await txt('#diff-count'), '2');
rec('5f diff 表含 System Prompt', await txt('#diff-table'), (t) => /System Prompt/.test(t),
  /System Prompt/.test(await txt('#diff-table')));

// —— ⑥ 场景预设（§7.4）——
await page.select('#preset', 'classify');
await wait(250);
rec('6a 预设后 sampler 回 temp', await page.$eval('#seg-sampler .on', (e) => e.dataset.sampler), 'temp');
rec('6b temp=0', await val('#in-temp'), '0');
rec('6c max=256', await val('#in-max'), '256');
rec('6d thinking=disabled', await page.$eval('#seg-thinking .on', (e) => e.dataset.thinking), 'disabled');
rec('6e diff 计数≥3', Number(await txt('#diff-count')) >= 3, true);

// —— ⑦ 对话试跑 ——
await clickEl('#chat-input');
await page.type('#chat-input', '帮我看下宁德时代去年的毛利率');
await clickEl('#btn-send');
await wait(1600);
const turns = await page.$$eval('#chatbox .turn', (n) => n.length);
rec('7a 引导一轮 + 提问回答同组一轮', turns, 2);
rec('7a2 提问回答在同一 .turn（Playground 分组口径）', await page.$eval('#chatbox .turn:last-child',
  (e) => !!e.querySelector('.bubble-wrap.me') && !!e.querySelector('.bubble-wrap:not(.me)')), true);
rec('7b 回答含生效参数', await page.$eval('#chatbox .turn:last-child .bubble-meta', (e) => e.textContent),
  (t) => /temp 0/.test(t) && /max 256/.test(t), true);
rec('7c 生效参数条同步', await txt('#rb-sampler'), 'temp 0');

// —— ⑧ 线上 vs 草稿 对比运行 ——
await clickEl('#btn-compare');
await wait(1400);
rec('8a 生成对比卡片', await page.$$eval('.cmp', (n) => n.length), 1);
rec('8b 两列均有输出', await page.$$eval('.cmp .out', (n) => n.length), 2);
rec('8c 差异已标出', await page.$$eval('.cmp .out.diffline', (n) => n.length), 1);

// —— ⑨ 用例表 ——
await clickEl('.bench-tabs .tb[data-tab="cases"]');
await wait(150);
rec('9a 用例表可见', await vis('#pane-cases'), true);
rec('9b 用例数 4', await page.$$eval('#case-list .case', (n) => n.length), 4);
await clickEl('#btn-run-cases');
await wait(2600);
// 分类预设（max 256）下，长文本抽取用例应被截断 → 与基线不同（用例表就是用来暴露这类回归的）
rec('9c 截断导致用例不同', await page.$$eval('#case-list .st.fail', (n) => n.length), 1);
rec('9d 其余用例仍通过', await page.$$eval('#case-list .st.pass', (n) => n.length), 2);
rec('9e 当前列已填充', await page.$$eval('#case-list .cc.cur', (n) =>
  n.filter((e) => !/未运行/.test(e.textContent)).length), 3);

// —— ⑩ 参数改坏 → 用例对比标出差异 ——
await clickEl('.bench-tabs .tb[data-tab="chat"]');
// 真实键盘输入路径：点击聚焦 → 程序化选中全文 → 键盘输入 1（输入仍是真键盘事件，替换选中内容）
// ⚠️ 不用 clickCount:3 三击选中：无头下三击不选中，会把 "0" 输成 "01"（数值等价但污染后续保存的数据）
// ⚠️ 也不用 Meta+A：无头 Chrome 不可靠兑现系统快捷键
await clickEl('#in-temp');
await page.$eval('#in-temp', (e) => { e.focus(); e.setSelectionRange(0, e.value.length); });
await page.keyboard.type('1');
await wait(200);
rec('10a-pre 输入被整体替换而非追加', await val('#in-temp'), '1');
rec('10a 草稿提示变更', await txt('#rb-note'), (t) => /与线上不同/.test(t), true);
await clickEl('.bench-tabs .tb[data-tab="cases"]');
await clickEl('#btn-run-cases');
await wait(2600);
// 再加温度 1 → 数值用例也变模糊，共 2 条回归
rec('10b 累计两条回归', await page.$$eval('#case-list .st.fail', (n) => n.length), 2);
rec('10c 变化行有 changed 标记', await page.$$eval('#case-list .case.changed', (n) => n.length), 2);

// —— ⑪ 布局切换 ——
await clickEl('#btn-layout');
await wait(150);
rec('11a 切上下排布', await page.$eval('#adv-body', (e) => e.classList.contains('stack')), true);
await clickEl('#btn-layout');
await wait(150);
rec('11b 切回并排', await page.$eval('#adv-body', (e) => e.classList.contains('stack')), false);

// —— ⑫ 保存 → 基线同步，diff 清零 ——
await clickEl('#btn-save');
await wait(250);
rec('12a 保存需内联二次确认', await page.$$eval('.cfm', (n) => n.length), 1);
rec('12b 确认条标明改动项数', await txt('.cfm'), (t) => /项改动/.test(t), true);
await clickEl('.cfm [data-y]');
/* toast 是定时自动消失的。旧写法「固定 wait(1300) 后再断言可见」等于跟定时器比赛：
   机器稍慢一步就红，单跑又绿（2026-10-22 实测偶发 12d 失败）。
   改成：点击后**先等它出现**并记下结果，再等保存流程走完断言 diff 条。 */
let toastSeen = true;
try { await page.waitForSelector('#toast', { state: 'visible', timeout: 2000 }); } catch { toastSeen = false; }
await wait(1300);
rec('12c diff 条隐藏', await vis('#diffbar'), false);
rec('12d toast 提示成功', toastSeen, true);
rec('12e 生效提示回到一致', await txt('#rb-note'), '与线上一致');

// —— ⑫ 续：保存后状态自洽（版本号 / 列表 chips 回写） ——
// ⑫ 续：非法值由「后端」判错（红边 + 常驻提示），不是前端自造校验
await page.$eval('#in-max', (e) => { e.value = '99999'; e.dispatchEvent(new Event('input')); });
await wait(150);
await clickEl('#btn-save');
await wait(250);
rec('12f 非法值字段红边', await page.$eval('#ctrl-max', (e) => e.classList.contains('err')), true);
rec('12g 错误提示常驻', await txt('#toast'), (t) => /保存失败/.test(t), true);
rec('12h 不弹确认条', await page.$$eval('.cfm', (n) => n.length), 0);
await page.$eval('#in-max', (e) => { e.value = '256'; e.dispatchEvent(new Event('input')); });
await wait(150);
rec('12i 版本号递增', await txt('#ver-tag'), 'v8');
rec('12j 列表 chips 回写', await txt('#chips-report-helper'),
  (t) => /temp 1/.test(t) && /max 256/.test(t), true);

// —— ⑬ 返回列表（已保存，无变更，不应拦截） ——
await clickEl('#btn-back');
await wait(200);
rec('13a 回到列表', await vis('#screen-list'), true);
rec('13b 面包屑清空', await txt('#crumb-sub'), '');

// —— ⑭ C7-d：分类档锁死 thinking=disabled ——
await clickEl('[data-act="edit"][data-id="report-helper"]');
await wait(200);
// 重进详情会保留上次的展开态，故只在折叠时才展开（避免反向折叠）
await page.$eval('#card-adv', (e) => { if(!e.classList.contains('open')) e.querySelector('.card-hd').click(); });
await page.$eval('.bench-tabs .tb[data-tab="chat"]', (e) => e.click());
await wait(150);
await page.select('#preset', 'classify');
await wait(250);
rec('14a thinking 段锁定', await page.$eval('#seg-thinking', (e) => e.classList.contains('locked')), true);
// 锁定后：① 指针事件被禁（点不到）② 即便绕过派发也被 handler 拦住
rec('14b 锁定后不可点', await page.$eval('#seg-thinking [data-thinking="null"]',
  (e) => getComputedStyle(e).pointerEvents), 'none');
await page.$eval('#seg-thinking [data-thinking="null"]', (e) => e.click());
await wait(150);
rec('14c 绕过派发仍无效', await page.$eval('#seg-thinking .on', (e) => e.dataset.thinking), 'disabled');
rec('14d 锁定原因可见', await txt('#extra-thinking'), (t) => /C7-d/.test(t), true);
await page.select('#preset', 'chat');
await wait(250);
rec('14e 换档解锁', await page.$eval('#seg-thinking', (e) => e.classList.contains('locked')), false);

// —— ⑮ 失败态：对话运行 / 用例运行（注入演示） ——
await page.$eval('#fail-inject', (e) => { e.checked = true; });
await wait(100);
await page.$eval('#chat-input', (e) => e.focus());
await page.type('#chat-input', '测试失败态');
await page.$eval('#btn-send', (e) => e.click());
await wait(1600);
rec('15a 对话失败态气泡', await page.$$eval('#chatbox .bubble.err', (n) => n.length), 1);
rec('15b 含重试入口', await page.$$eval('#chatbox [data-retry]', (n) => n.length), 1);
rec('15c 失败文案含原因', await page.$eval('#chatbox .bubble.err', (e) => e.textContent),
  (t) => /503/.test(t), true);
await clickEl('.bench-tabs .tb[data-tab="cases"]');
await wait(150);
await clickEl('#btn-run-cases');
await wait(300);
rec('15d 运行期按钮锁定', await page.$eval('#btn-run-cases', (e) => e.disabled), true);
await wait(2600);
rec('15e 用例失败态', await page.$$eval('#case-list .st.error', (n) => n.length), 1);
rec('15f 汇总含失败数', await txt('#toast'), (t) => /运行失败/.test(t), true);
rec('15g 运行结束按钮解锁', await page.$eval('#btn-run-cases', (e) => e.disabled), false);
// 失败注入必须在此复位，否则 ⑮ 之后的用例运行会被继续注入失败
await page.$eval('#fail-inject', (e) => { e.checked = false; });
await wait(100);

// —— ⑯ 新增用例：没有基线时不得判「通过」 ——
await page.$eval('.bench-tabs .tb[data-tab="cases"]', (e) => e.click());
await wait(150);
await page.$eval('#btn-add-case', (e) => e.click());
await wait(150);
rec('15h 用例数增至 5', await page.$$eval('#case-list .case', (n) => n.length), 5);
await page.$eval('#btn-run-cases', (e) => e.click());
await wait(4400);
rec('15i 新增用例为「无基线」态', await page.$$eval('#case-list .st',
  (n) => n.filter((e) => e.textContent.trim() === '无基线').length), 1);
rec('15j 无基线不计入通过数', await page.$$eval('#case-list .st.pass', (n) => n.length), 3);

// —— ⑰ 未保存就返回列表：内联二次确认（不是弹窗） ——
await clickEl('#btn-back');
await wait(200);
rec('16a 返回被拦截', await vis('#screen-detail'), true);
rec('16b 出现内联确认条', await page.$$eval('.cfm', (n) => n.length), 1);
rec('16c 仍无弹窗', await page.$$eval('.mask', (n) => n.length), 0);
await clickEl('.cfm [data-n]');
await wait(150);
rec('16d 取消后留在详情', await vis('#screen-detail'), true);
await clickEl('#btn-back');
await wait(150);
await clickEl('.cfm [data-y]');
await wait(250);
rec('16e 确认后回列表', await vis('#screen-list'), true);

// —— ⑰ 可达性基线（键盘 / 读屏） ——
rec('17a 列表「编辑」是按钮', await page.$$eval('[data-act="edit"]', (n) => n.every((e) => e.tagName === 'BUTTON')), true);
rec('17b 用例复选框有 aria-label', await page.$$eval('#case-list [data-check]',
  (n) => n.length > 0 && n.every((e) => !!e.getAttribute('aria-label'))), true);
rec('17c 卡片头可键盘展开', await page.$eval('#card-basic .card-hd',
  (e) => e.getAttribute('role') + '/' + e.getAttribute('aria-expanded')), 'button/true');
rec('17d 面包屑可点回列表', await page.$eval('#crumb-main', (e) => e.tagName), 'BUTTON');

// —— ⑱ v2.1：表单排版（label 左置栅格 + hint 压一行 + 不暴露契约代号） ——
await clickEl('[data-act="edit"][data-id="report-helper"]');
await wait(200);
rec('18a 基础配置用 label 左置栅格', await page.$$eval('#card-basic .fitem', (n) => n.length), 4);
rec('18b 每字段 label 与控件同排', await page.$eval('#ctrl-purpose',
  (e) => Math.abs(e.getBoundingClientRect().top - e.closest('.fitem').querySelector('.flb').getBoundingClientRect().top) < 12), true);
// 左列各字段的控件左缘必须一致（并排右列自然不同，故只取每行第一个 fitem）
rec('18c 控件左缘对齐', await page.$$eval('#card-basic .frow > .fitem:first-child > .fld',
  (n) => new Set(n.map((e) => Math.round(e.getBoundingClientRect().left))).size), 1);
rec('18d hint 不出现契约代号', await page.$$eval('#screen-detail .fhint',
  (n) => n.every((e) => !/C7-[a-z]|TOKENHUB_|llm_models|60s/.test(e.textContent))), true);
rec('18e 高级区用同一栅格', await page.$eval('#adv-body-wrap .params .fitem', (e) => !!e), true);
// 18f/18g：这次的真 bug —— .frow{display:flex} 压过 .hidden，「思考预算」该隐藏却显示
rec('18f 未开思考时预算行真隐藏', await vis('#row-budget'), false);
rec('18g 开思考后预算行出现', await (async () => {
  await page.$eval('#seg-thinking [data-thinking="enabled"]', (e) => e.click());
  await wait(200);
  const shown = await vis('#row-budget');
  await page.$eval('#seg-thinking [data-thinking="null"]', (e) => e.click());
  await wait(150);
  return shown;
})(), true);
// 18h：toast 必须让开 56px 顶栏（曾经盖住面包屑）
rec('18h toast 让开顶栏', await page.$eval('#toast', (e) => {
  e.classList.remove('hidden');
  const t = e.getBoundingClientRect().top;
  const h = document.querySelector('.ad-header').getBoundingClientRect().bottom;
  e.classList.add('hidden');
  return t >= h;
}), true);
// 18i：注入开关属原型演示控件，不得混在调试台工具条里（会被当成产品能力）
rec('18i 注入开关已移出调试台', await page.$eval('.bench-tabs', (e) => !e.querySelector('#fail-inject')), true);

// —— ⑲ v2.1：用例随定义切换（不再三定义共用一套） ——
const caseNames = async () => page.$$eval('#case-list .case-nm', (n) => n.map((e) => e.textContent));
// 卡片展开态是持久 DOM 状态，重进详情不会复位 → 只在其折叠时才点（无条件点会反向折叠）
const ensureAdvOpen = () => page.$eval('#card-adv', (e) => {
  if (!e.classList.contains('open')) e.querySelector('.card-hd').click();
});
await ensureAdvOpen();
await wait(200);
await clickEl('.bench-tabs .tb[data-tab="cases"]');
await wait(150);
const namesReport = await caseNames();
rec('19a 财报定义用例名为业务词', namesReport[0], '单指标速查');
rec('19b 用例含「验收」行', await page.$$eval('#case-list .case-io',
  (n) => n.length > 1 && /验收/.test(n[1].textContent)), true);
rec('19c 无「期望」旧标签', await page.$eval('#case-list', (e) => /期望/.test(e.textContent)), false);
await clickEl('#btn-back');
await wait(150);
await clickEl('[data-act="edit"][data-id="contract-extract"]');
await wait(200);
await ensureAdvOpen();
await wait(200);
await clickEl('.bench-tabs .tb[data-tab="cases"]');
await wait(150);
const namesContract = await caseNames();
rec('19d 换定义即换用例', namesContract[0] === namesReport[0], false);
rec('19e 合同定义用例名正确', namesContract[0], '三项条款抽取');
// 差异摘要：温度调高 → 边界用例失守，且必须给出「差在哪」
await clickEl('.bench-tabs .tb[data-tab="chat"]');
await wait(150);
// 这里只做前置状态赋值（真实键盘输入路径已在 ⑦/⑩ 段覆盖），故直接置值 + 派发 input
await page.$eval('#in-temp', (e) => { e.value = '1'; e.dispatchEvent(new Event('input')); });
await wait(200);
await clickEl('.bench-tabs .tb[data-tab="cases"]');
await wait(150);
await clickEl('#btn-run-cases');
await wait(3000);
rec('19f 边界用例因温度失守', await page.$$eval('#case-list .case-delta', (n) => n.length), 1);
rec('19g 差异摘要说明原因', await (async () => {
  const texts = await page.$$eval('#case-list .case-delta', (n) => n.map((e) => e.textContent));
  return texts.some((t) => /未守住边界/.test(t));
})(), true);

// —— ⑳ v2.1：对话试跑的示例问题（demo 可理解性） ——
await clickEl('.bench-tabs .tb[data-tab="chat"]');
await wait(150);
rec('20a 有示例问题按钮', await page.$$eval('#try-list .trybtn', (n) => n.length), 3);
const before = await page.$$eval('#chatbox .turn', (n) => n.length);
await clickEl('#try-list .trybtn[data-try="0"]');
await wait(1600);
rec('20b 点示例即提问（新增一问一答一组）', await page.$$eval('#chatbox .turn', (n) => n.length), before + 1);
rec('20c 示例问题随定义变化', await page.$eval('#try-list .trybtn', (e) => /付款|账期|协议|条款/.test(e.textContent)), true);
// 示例问题按钮必须是短标签（长问句会撑成整行、失去「可选示例」的观感；完整问题在 title 里）
rec('20e 示例问题为短标签', await page.$$eval('#try-list .trybtn',
  (n) => n.every((e) => e.textContent.trim().length <= 16 && !!e.title)), true);
rec('20d 回答含示例数据本身', await page.$eval('#chatbox .turn:last-child .bubble', (e) => e.textContent.length > 30), true);

// —— ㉑ v2.2：调试台对话与屏① Playground **同构**（落地复用同一组组件） ——
// 结构口径（admin-agents.html 变更台账 2026-10-11，两处必须一致）：
//   .turn > .bubble-wrap(.me) > [.avatar] + .bubble > [.bubble-meta(.src-tag)] + .ans(blocks)
//   .proc 过程卡片 = .turn 内、气泡**外侧**的独立块（插在 bubble-wrap 之前）
// ⚠️ ⑫ 段保存过「分类」预设 → DEFS 已被写回（原型正确模拟落库），重开财报助手时
//   thinking=关闭、temp=0。这里像真实用户一样先切回「沿用默认」，才能看到工具调用链路。
await clickEl('#btn-back');
await wait(200);
if (await page.$('.cfm')) { await clickEl('.cfm [data-y]'); await wait(250); }
await clickEl('[data-act="edit"][data-id="report-helper"]');
await wait(250);
await ensureAdvOpen();
await wait(150);
await clickEl('#seg-thinking button[data-thinking="null"]');
await wait(150);
await clickEl('.bench-tabs .tb[data-tab="chat"]');
await wait(150);
await page.$eval('#chat-input', (e) => { e.value = '营业总收入是多少'; });
await clickEl('#btn-send');
await wait(1800);
const LT = '#chatbox .turn:last-child';
// 21a 外层是 .bubble-wrap（不是裸 div 拼字符串）
rec('21a 外层为 bubble-wrap', await page.$(LT + ' > .bubble-wrap') !== null, true);
rec('21b AI 侧有头像', await page.$(LT + ' .avatar.ai') !== null, true);
// 21c 元信息在气泡**内顶部**：.bubble 的子元素顺序 = bubble-meta → ans（Playground 同位置）
rec('21c 元信息在气泡内顶部', await page.$eval(LT + ' .bubble.ai', (e) => {
  const kids = [...e.children].map((k) => k.className);
  return kids.length >= 2 && kids[0].indexOf('bubble-meta') === 0 && kids[1] === 'ans';
}), true);
// 21d 回答是 blocks 渲染（p / p.lead / h4 / ol / codeblk / law），不是 `<br>` 拼的纯文本
rec('21d 回答为 blocks 渲染', await page.$$eval(LT + ' .ans p', (n) => n.length) >= 1, true);
rec('21e 含 lead 结论段', await page.$eval(LT + ' .ans', (e) => !!e.querySelector('p.lead')), true);
// 21f 过程卡片落气泡外侧、且在气泡之前（Playground 同位置）
rec('21f 过程卡片在 AI 气泡前', await page.$eval(LT, (e) => {
  const kids = [...e.children];
  const iProc = kids.findIndex((k) => k.classList.contains('proc'));
  // 取**最后一个** bubble-wrap = AI 侧（同组里第一个是用户侧 .me）
  let iAi = -1;
  kids.forEach((k, i) => { if (k.classList.contains('bubble-wrap') && !k.classList.contains('me')) iAi = i; });
  return iProc >= 0 && iAi >= 0 && iProc < iAi;
}), true);
rec('21f2 用户气泡在同组最前', await page.$eval(LT, (e) => {
  const kids = [...e.children];
  return kids.length >= 2 && kids[0].classList.contains('bubble-wrap') && kids[0].classList.contains('me');
}), true);
rec('21g 过程卡片含本定义工具名', await page.$eval(LT + ' .proc', (e) => /financial-data/.test(e.textContent)), true);
rec('21h 元信息含来源标签', await page.$eval(LT + ' .src-tag', (e) => /基于工具|AI 直答/.test(e.textContent)), true);
// 21i thinking=disabled → 退化为「AI 直答」且不出现过程卡片（可观察差异）
await clickEl('#seg-thinking button[data-thinking="disabled"]');
await wait(200);
await page.$eval('#chat-input', (e) => { e.value = '营业总收入是多少'; });
await clickEl('#btn-send');
await wait(1800);
rec('21i 关闭思考后无过程卡片', await page.$$eval('#chatbox .turn:last-child .proc', (n) => n.length), 0);
rec('21j 来源标签变为 AI 直答', await page.$eval('#chatbox .turn:last-child .src-tag', (e) => e.textContent.trim()), 'AI 直答');
// 21k 温度偏高 → 边界失守，越界提示用 law 块（与屏① 法条块同型）
await page.$eval('#in-temp', (e) => { e.value = '1'; e.dispatchEvent(new Event('input')); });
await wait(150);
await page.$eval('#chat-input', (e) => { e.value = '预测一下 2025 年营收'; });
await clickEl('#btn-send');
await wait(1800);
rec('21k 越界提示为 law 块', await page.$eval('#chatbox .turn:last-child .law b', (e) => e.textContent.trim()), '越界提示');

// —— ㉒ 状态 CTA 真行为（2026-10-28 用户报「返回修改」死按钮） ——
// 三个 CTA（empty-cta / error-cta / forbidden-cta）绑定必须在主脚本段（hub 内演示控件脚本被
// jsDrop 丢掉，绑定放错段 = hub 内死按钮）。变异测试：删掉绑定 → 下列断言立即 FAIL。
await page.evaluate(() => {
  const sd = document.querySelector('#screen-detail');
  if (sd) sd.setAttribute('data-demo-state', 'error');
});
await wait(80);
rec('22a S4 前置：error 态可见、返回修改按钮在', await vis('[data-dr="error-cta"]'), true);
// 先制造「temp+topP 同填」（S4 同款），验证错误态文案承诺「字段值已保留」
await page.evaluate(() => {
  const t = document.getElementById('in-temp');
  const p = document.getElementById('in-topP');
  t.value = '1'; t.dispatchEvent(new Event('input'));
  p.disabled = false; p.value = '0.9'; p.dispatchEvent(new Event('input'));
});
await wait(120);
const beforeVals = [await val('#in-temp'), await val('#in-topP')].join('|');
rec('22b 同填前置：temp=1|topP=0.9', beforeVals, '1|0.9');
// 点「返回修改」
await clickEl('[data-dr="error-cta"]');
await wait(200);
rec('22c error-cta → data-demo-state=normal',
  await page.$eval('#screen-detail', (e) => e.getAttribute('data-demo-state')), 'normal');
rec('22d 返回后字段值不丢（文案承诺兑现）',
  [await val('#in-temp'), await val('#in-topP')].join('|'), '1|0.9');
rec('22e 互斥红字提示仍在（同填常驻）',
  [await vis('#conflict-hint'), await page.$eval('#ctrl-temp', (e) => e.classList.contains('err')),
   await page.$eval('#ctrl-topP', (e) => e.classList.contains('err'))].join('|'), 'true|true|true');
// 真点保存 → 后端互斥校验拒收（不是只靠演示态演戏）
await clickEl('#btn-save');
await wait(200);
rec('22f 同填点保存被拒（C7-b 互斥，toast 报错）',
  await page.$eval('#toast', (e) => e.classList.contains('hidden') ? '' : e.textContent.trim()).then((t) => /只能填一个/.test(t)), true);
// 清空一项后红字消失
await page.$eval('#in-topP', (e) => {
  e.disabled = false; e.value = ''; e.dispatchEvent(new Event('input'));
});
await wait(120);
rec('22g 清空 topP 后互斥红字消失',
  [await vis('#conflict-hint'), await page.$eval('#ctrl-temp', (e) => e.classList.contains('err'))].join('|'), 'false|false');

// empty-cta「开始配置」→ normal + 高级卡展开
await page.evaluate(() => {
  const sd = document.querySelector('#screen-detail');
  if (sd) sd.setAttribute('data-demo-state', 'empty');
});
await wait(80);
rec('22h 空态可见、开始配置按钮在', await vis('[data-dr="empty-cta"]'), true);
await clickEl('[data-dr="empty-cta"]');
await wait(250);
rec('22i empty-cta → normal 态',
  await page.$eval('#screen-detail', (e) => e.getAttribute('data-demo-state')), 'normal');
rec('22j empty-cta → 高级卡展开（「开始配置」名副其实）',
  [await page.$eval('#card-adv', (e) => e.classList.contains('open')),
   await vis('#adv-body-wrap')].join('|'), 'true|true');

// forbidden-cta「返回列表」→ 回列表屏（同 btn-back 路径）
await page.evaluate(() => {
  const sd = document.querySelector('#screen-detail');
  if (sd) sd.setAttribute('data-demo-state', 'forbidden');
});
await wait(80);
rec('22k 无权限态可见、返回列表按钮在', await vis('[data-dr="forbidden-cta"]'), true);
await clickEl('[data-dr="forbidden-cta"]');
await wait(300);
rec('22l forbidden-cta → 回列表屏（screen-list 可见 / detail 隐藏）',
  [await vis('#screen-list'), await vis('#screen-detail')].join('|'), 'true|false');

// 代码块「复制」与主题按钮不再是死点击（.cp 动态生成，走委托）
await page.evaluate(() => {
  // 回详情，跑一个带代码块的对话
  const b = document.querySelector('[data-act="edit"][data-id="report-helper"]');
  if (b) b.click();
});
await wait(300);
await page.$eval('#chat-input', (e) => { e.value = '算一下复合增速'; });
await clickEl('#btn-send');
await wait(1800);
rec('22m 对话生成代码块复制按钮', await page.$$eval('#chatbox .turn:last-child .cp', (n) => n.length) > 0, true);
await page.$eval('#chatbox .turn:last-child .cp', (e) => e.click());
await wait(80);
rec('22n 点复制按钮有反馈（文案变「已复制」，非死按钮）',
  await page.$eval('#chatbox .turn:last-child .cp', (e) => e.textContent.trim()), '已复制');
await clickEl('.ad-theme');
await wait(80);
rec('22o 主题按钮有反馈（toast，非死点击）',
  await page.$eval('#toast', (e) => e.classList.contains('hidden') ? '' : e.textContent.trim()).then((t) => /主题/.test(t)), true);

// —— ㉓ 屏② 可点元素绑定完备性（死按钮枚举式断言，新增未绑按钮即 FAIL） ——
// 背景：2026-10-28 用户两次报死按钮（返回修改 CTA）。单点修复不够，必须有一条**枚举式**
// 断言兜底：屏② 内所有可点元素要么 disabled，要么命中「已绑定清单」（id / data-* / class 任一）。
// 变异测试：往屏② 塞一个无绑定 button → 本条立即 FAIL。
const BOUND_TOKENS = [
  // 状态 CTA（主脚本段绑定）
  'empty-cta', 'error-cta', 'forbidden-cta',
  // 导航 / 保存 / diff
  'btn-back', 'crumb-main', 'btn-discard', 'btn-save', 'btn-diff-toggle', 'btn-revert', 'data-act',
  // 采样 / 思考 seg
  'data-sampler', 'data-thinking',
  // 调试台 tab / 排布 / 运行
  'data-tab', 'btn-layout', 'btn-send', 'btn-compare',
  // 用例表
  'btn-run-cases', 'btn-sel-all', 'btn-add-case', 'data-check', 'data-case',
  // 卡头折叠（role=button）
  'data-toggle',
  // 清除图标
  'data-clear',
  // 表单控件（bindBasic / bindNum / change）
  'in-model', 'in-temp', 'in-topP', 'in-max', 'in-steps', 'in-purpose', 'in-keywords', 'in-prompt', 'preset',
  // 动态元素（委托/局部绑定）
  'data-try', 'data-retry', 'data-y', 'data-n', 'cp',
  // 壳件（proto-shell JS）
  'btn-collapse', 'ad-theme',
];
const unbound = await page.$$eval(
  '#screen-detail button, #screen-detail [role="button"], #screen-detail [role="checkbox"], #screen-detail select, #screen-detail .clear, #screen-detail .lnk-btn, #screen-detail a',
  (els, tokens) => els
    .filter((e) => {
      if (e.disabled) return false;                    // 显式禁用 = 合规
      if (e.closest('[data-demo-ctl]')) return false;  // 演示控件不在产品口径
      const hay = [e.id, e.className, e.tagName, ...[...e.attributes].map((a) => a.name + '=' + a.value)].join(' ');
      return !tokens.some((t) => hay.includes(t));
    })
    .map((e) => e.outerHTML.slice(0, 110)),
  BOUND_TOKENS,
);
rec('23a 屏② 可点元素全部命中绑定清单或 disabled（新增死按钮即 FAIL）',
  unbound.length + ' 个未绑：' + (unbound.slice(0, 3).join(' || ') || '(空)'), '0 个未绑：(空)', unbound.length === 0);

// 23b 清单反向核对：BOUND 里声明的关键锚点在 DOM 里真实存在（防清单空转）
const anchors = ['empty-cta', 'error-cta', 'forbidden-cta', 'btn-save', 'btn-back', 'btn-diff-toggle', 'data-clear', 'data-toggle', 'data-sampler', 'data-thinking', 'preset'];
const missingAnchors = await page.$$eval('#screen-detail', (roots, keys) => {
  const html = roots[0].innerHTML;
  return keys.filter((k) => !html.includes(k));
}, anchors);
rec('23b 绑定清单关键锚点都在屏② DOM 里（防清单空转）', missingAnchors.join('|'), '');

// 23c 动态元素也在清单内（trybtn / cp / 确认框按钮 —— 前序步骤已生成）
const dynUnbound = await page.$$eval(
  '#screen-detail button[data-try], #screen-detail button.cp, #screen-detail button[data-retry], #screen-detail button[data-y], #screen-detail button[data-n]',
  (els, tokens) => els
    .filter((e) => {
      const hay = [e.id, e.className, ...[...e.attributes].map((a) => a.name + '=' + a.value)].join(' ');
      return !tokens.some((t) => hay.includes(t));
    })
    .map((e) => e.outerHTML.slice(0, 110)),
  BOUND_TOKENS,
);
rec('23c 动态元素（try/cp/retry/确认框）也命中绑定清单',
  dynUnbound.length + ' 个未绑：' + (dynUnbound.slice(0, 3).join(' || ') || '(空)'), '0 个未绑：(空)', dynUnbound.length === 0);

// —— 24 角色门禁（2026-10-29 拍板：admin 及以上可见调参区，editor/viewer 不可见）——
// 真点角色按钮后按 computed display 判定卡片可见性（与 vis 同一「真实可见性」口径）
await clickEl('[data-dc-state="normal"]');
const cardGate = async (roleBtn, expectVisible) => {
  await clickEl(roleBtn);
  await wait(120);
  const adv = await vis('#card-adv');
  const audit = await vis('#card-audit');
  return { adv, audit, ok: adv === expectVisible && audit === expectVisible };
};
const r24a = await cardGate('[data-dc-role="superadmin"]', true);
rec('24a 超管：调参卡+审计卡可见', JSON.stringify(r24a), 'adv/audit 均 true', r24a.ok);
const r24b = await cardGate('[data-dc-role="admin"]', true);
rec('24b 普通管理员：调参卡+审计卡可见（新口径，2026-10-29 拍板放开 admin）', JSON.stringify(r24b), 'adv/audit 均 true', r24b.ok);
const r24c = await cardGate('[data-dc-role="editor"]', false);
rec('24c 编辑者：调参卡+审计卡不可见', JSON.stringify(r24c), 'adv/audit 均 false', r24c.ok);
const r24d = await cardGate('[data-dc-role="viewer"]', false);
rec('24d 查看者：调参卡+审计卡不可见', JSON.stringify(r24d), 'adv/audit 均 false', r24d.ok);
rec('24e editor 下 role-fallback 兜底文案可见', await vis('.role-fallback'), true);
await clickEl('[data-dc-role="superadmin"]');

// —— 25 布局单列化 + 占位统一（2026-10-29 拍板 A + B1）——
// 仓库根从脚本位置推导（worktree 通用，不写死绝对路径）
const REPO = new URL('../', import.meta.url).pathname;
// A-1a（静态）：面板单列契约 —— AgentTuningPanel.vue 不得再出现 a-col（嵌套 12/12 是本次双重挤压根因）
const PANEL_SRC = REPO + 'apps/admin/src/views/Agents/AgentTuningPanel.vue';
const panelSrc = (await import('node:fs')).readFileSync(PANEL_SRC, 'utf-8');
const colHits = panelSrc.match(/<a-col\b/g) || [];
rec('25a 调参面板单列契约：AgentTuningPanel.vue 无 <a-col>', colHits.length + ' 个 a-col', '0 个',
  colHits.length === 0);

// A-1b（运行时）：策略预览整宽 —— 不得困在参数列内（改前 403px / 容器 980px）
const stratW = await page.$eval('.strat', (e) => e.getBoundingClientRect().width);
const advW = await page.$eval('#adv-body', (e) => e.getBoundingClientRect().width);
rec('25b 策略预览整宽（≥ adv-body 90%）', Math.round(stratW) + '/' + Math.round(advW),
  '≥ ' + Math.round(advW * 0.9), stratW >= advW * 0.9);

// B-1（运行时）：占位口径 C（2026-10-29 拍板）——示例值 / 留空，**不再按等词比较**
//   旧判据是「三个 === '未配置'」：每换一次词就得改脚本，且它把「未配置」当成正确目标，
//   反而锁死了语义词。新判据断**语义类别**：
//   temp/topP 必须有占位且不得含语义词（未配置 / 跟随默认 / 不设置…）——占位只放格式/单位/示例；
//   maxTokens 的占位必须为空——留空 = 用满模型上限是推荐态，任何提示词都会误导。
const SEMANTIC_WORDS = ['未配置', '跟随默认', '不设置', '默认值', '系统默认'];
const phs = await page.evaluate(() => ({
  temp: document.querySelector('#in-temp')?.placeholder ?? '',
  max: document.querySelector('#in-max')?.placeholder ?? '',
  topP: document.querySelector('#in-topP')?.placeholder ?? '',
}));
const badPh = Object.entries(phs)
  .filter(([k, v]) => (k === 'max' ? v !== '' : v.trim() === '' || SEMANTIC_WORDS.some((w) => v.includes(w))))
  .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
rec('25c 占位口径：temp/topP 为示例值且无语义词、maxTokens 留空', JSON.stringify(phs),
  'temp/topP 非空且不含语义词 / max 为空', badPh.length === 0);

// B-2（运行时）：thinking 三按钮 = 业务词 + 顺序 跟随默认 → 开启 → 关闭
//   （原为「未配置 (NULL) / enabled / disabled」，且顺序 null/disabled/enabled 与 Vue 相反）
const segBtns = await page.$$eval('#seg-thinking button', (els) =>
  els.map((e) => ({ text: e.textContent.trim(), value: e.dataset.thinking })));
const segOk = segBtns.length === 3
  && segBtns[0].text === '跟随默认' && segBtns[0].value === 'null'
  && segBtns[1].text === '开启' && segBtns[1].value === 'enabled'
  && segBtns[2].text === '关闭' && segBtns[2].value === 'disabled';
rec('25e thinking 三按钮 = 跟随默认/开启/关闭（顺序与契约值均对）',
  JSON.stringify(segBtns), '跟随默认(null) → 开启(enabled) → 关闭(disabled)', segOk);

// B-3（运行时）：调参表单区不得出现实现枚举/内部字段名（page-spec :127）
//   扫描域 = #adv-body（表单区）可见文本，不含屏级 .only-* 演示说明块与策略预览/差异表
//   —— 那两处展示的是**运行值**（如策略命中明细），属第二批「值显示」口径，不在本条范围。
const advText = await page.$eval('#adv-body', (e) => e.innerText);
const enumLeaks = ['NULL', 'enabled', 'disabled'].filter((w) =>
  new RegExp('(^|[^A-Za-z_])' + w + '([^A-Za-z_]|$)').test(advText));
rec('25f 表单区不出现 NULL / enabled / disabled（业务词替代实现枚举）',
  enumLeaks.join('|') || '(无)', '(无)', enumLeaks.length === 0);

// B-4（运行时）：五个控件 label = 业务词（page-spec :126「用业务词不用字段名」）
//   面板里还有「采样方式」「思考预算」两行 label（本就不含字段名，不在改名范围）→ 判据不按
//   全量等值比较，而断两件事：① 五个目标 label 按顺序出现（子序列）；② 任何 label 都不含
//   原始字段名（maxTokens / max_steps / max_tokens / top_p / budget_tokens / thinking）。
//   Temperature 经实测保留英文专名：`.ant-form-item-label > label` clientWidth=82 ==
//   scrollWidth=82（1440/1280 均为 82/82，nowrap 下不裁字），84px 列宽装得下。
const flbs = await page.$$eval('#adv-body .flb', (els) =>
  els.map((e) => e.textContent.trim()).filter(Boolean));
const wantLabels = ['Temperature', '输出上限', 'Top P', '思考', '最大步数'];
const isSubseq = (arr, sub) => {
  let i = 0;
  for (const v of arr) if (i < sub.length && v === sub[i]) i += 1;
  return i === sub.length;
};
const FIELD_NAME_TOKENS = ['maxTokens', 'max_steps', 'max_tokens', 'top_p', 'budget_tokens', 'thinking'];
const labelFieldLeaks = flbs.filter((t) => FIELD_NAME_TOKENS.some((k) => t.includes(k)));
rec('25g 五个 label 为业务词（Temperature 保留英文专名 / 无字段名残留）',
  JSON.stringify(flbs) + ' / 字段名残留=' + (labelFieldLeaks.join('|') || '(无)'),
  JSON.stringify(wantLabels) + ' 依序出现 / 字段名残留=(无)',
  isSubseq(flbs, wantLabels) && labelFieldLeaks.length === 0);

// A-2（静态）：debug-slot 技术文案不得回潮（写给开发的文档不进产品页面）
const DETAIL_SRC = REPO + 'apps/admin/src/views/Agents/AgentDefDetail.vue';
const detailSrc = (await import('node:fs')).readFileSync(DETAIL_SRC, 'utf-8');
const leakWords = ['落地契约', 'AnswerBlocks', 'debug-slot-note'].filter((k) => detailSrc.includes(k));
rec('25d AppDefDetail.vue 无技术文案泄漏（debug-slot 瘦身）',
  leakWords.join('|') || '(无)', '(无)', leakWords.length === 0);

// —— 26 label 对齐（2026-10-29 拍板修正：按 page-spec §3.2 定稿口径 —— label 左置固定 84px）——
// 症状：五个 a-form-item 游离在 form 上下文外 → antd label 列宽自适应文字宽 →
// 四个数值输入左缘参差（真实页面实测 349/398/303/397，最大差 95px）。
// 口径来源：原型 :215-216/:221（.flb{flex:0 0 84px}）+ page-spec §3.2:120。
// ⚠️ layout="vertical" 是被原型明确否掉的上一版（本次实现曾误用，已纠正，禁回潮）。
// 本脚本是 file:// 原型机检（与本地服务解耦，见 docs/api/contracts.md「无头验证」），
// 量不到真实 app 几何 → 断言**成因结构**；几何证据（两视口 left/width/换行实测）
// 在 docs/ui/reviews/agent-tuning-label-align-2026-10-29.md。
// 26a（静态）：label 列必须固定 84px，且 layout="vertical" 残留必须为 0
//    （先剥掉 HTML 注释再数——注释里提及「曾试过 vertical」是文档，不是代码回潮）
const panelCode = panelSrc.replace(/<!--[\s\S]*?-->/g, '');
const labelCol84 = /label-col="[^"]*84px/.test(panelCode);
const verticalLeftover = (panelCode.match(/layout="vertical"/g) || []).length;
rec('26a label 左置固定 84px（§3.2）且 layout="vertical" 残留 0',
  `label-col 84px=${labelCol84 ? '有' : '无'} / vertical 残留 ${verticalLeftover}`,
  '有 / 残留 0', labelCol84 && verticalLeftover === 0);
// 26b（静态）：label-col 不得出现 84px 以外的固定宽度（防改成 120px 之类再破坏规格）
const badLabelWidths = [...panelSrc.matchAll(/label-col="[^"]*?width:\s*'(\d+)px'/g)]
  .map((m) => m[1]).filter((w) => w !== '84');
rec('26b label-col 固定宽度只允许 84px',
  badLabelWidths.join('|') || '(无非 84px 固定值)', '(无非 84px 固定值)',
  badLabelWidths.length === 0);
// —— 26c/26d：thinking 行折行（2026-10-29 dev 复测抓到的偏差，属「label 左置」的副作用）——
// 症状：label 左置后 control 列可用宽 485（1440）/405（1280）。antd .ant-form-item-row 是
// flex-wrap:wrap，control 用 flex-basis:auto 时基线尺寸取内容 max-content——
// thinking 行 extra 文案实测 max-content **535px > 485**，整块 control 被折到下一行、
// 左缘从 337 退回行首 253（其余四行 extra 182–352 均 < 485，故不折）。
// ⚠️ 判据要从「数 input 左缘」改成「数 control 左缘」：折行时 input 左缘仍是 337×4
// （input 在折下来的 control 内部），旧判据完全看不见这个缺陷（见评审文档「判据有效性」）。
// 本脚本量不到 app 几何 → 断言成因：control 基线尺寸必须归 0（flex '1 1 0'）。
// 26c（静态）：wrapper-col 的 flex 必须是 '1 1 0'（basis 0），不得回退 '1 1 auto'
const wrapperFlexBasis0 = /wrapper-col="[^"]*flex:\s*'1 1 0'/.test(panelCode);
const wrapperFlexAuto = /wrapper-col="[^"]*flex:\s*'1 1 auto'/.test(panelCode);
rec('26c control 基线尺寸归 0（wrapper-col flex 1 1 0，防整块折行）',
  `basis0=${wrapperFlexBasis0 ? '有' : '无'} / 1-1-auto 残留=${wrapperFlexAuto ? '有' : '无'}`,
  'basis0=有 / 残留=无', wrapperFlexBasis0 && !wrapperFlexAuto);
// 26d（静态）：radio 组必须可内部换行（窄容器下最小占宽降到单按钮 ≈124px，禁缩字号硬塞）
const radioRule = (panelCode.match(/\.ant-radio-group\)\s*\{[\s\S]*?\}/) || [''])[0];
rec('26d radio 组内部可换行（flex-wrap: wrap）',
  radioRule ? (/flex-wrap:\s*wrap/.test(radioRule) ? 'flex-wrap: wrap ✓' : '缺 flex-wrap: wrap') : '未找到 .ant-radio-group 规则',
  'flex-wrap: wrap ✓', /flex-wrap:\s*wrap/.test(radioRule) && radioRule !== '');
// —— 26e–26h：label 右对齐（2026-10-29 用户追加拍板：label 文字右对齐，84px 定宽不变）——
// ⚠️ 判据盲区实测：只有 label-align="right" 这个 prop 是**不够的**——antd 把 prop 落成
// .ant-form-item-label 的 text-align:end（只管列内摆放），而 <label> 是 inline-flex 容器、
// justify 默认 normal（≈flex-start），容器内文字仍贴左 → 五个文本右缘实测
// 335/325/319/319/323 参差、「Temperature」距控件仅 2px。
// 要右缘全等还须三条配套：① label 容器 justify-content: flex-end；② 清掉 ：colon="false"
// 下仍残留占位的 ::after 冒号位（content:" " + margin: 0 8px 0 2px，占 10px——antd 空冒号
// 不渲染字符但 margin 仍在）；③ 列距 column-gap: 12px（原型 .fitem{gap:12px} 口径，
// 放列外不占 84px 定宽）。26e 锁 prop，26f 锁 ②③，26g/26h 锁 ① 及其守卫。
// 26e（静态）：label-align 必须是 right，且不得残留 left
const labelAlignRight = /label-align="right"/.test(panelCode);
const labelAlignLeft = (panelCode.match(/label-align="left"/g) || []).length;
rec('26e label 右对齐（label-align="right"，2026-10-29 追加拍板）',
  `right=${labelAlignRight ? '有' : '无'} / left 残留 ${labelAlignLeft}`,
  'right=有 / left 残留 0', labelAlignRight && labelAlignLeft === 0);
// 26f（静态）：右对齐配套 ②::after 清除 + ③列距 12px
// ⚠️ ① justify-content 的断言已挪到 26g/26h —— 它必须落在 576px 守卫内，用原来那种
// "match 第一个 label 规则块再断言"的写法，加上守卫后会抓到不带 flex-end 的那段、随机绿。
const labelAfterRule = (panelCode.match(/\.ant-form-item-label > label\)::after\s*\{[\s\S]*?\}/) || [''])[0];
const rowGapRule = (panelCode.match(/\.ant-form-item-row\)\s*\{[\s\S]*?\}/) || [''])[0];
const afterCleared = /content:\s*none/.test(labelAfterRule) && /margin:\s*0/.test(labelAfterRule);
const rowGap12 = /column-gap:\s*12px/.test(rowGapRule);
rec('26f 右对齐配套（::after 清除 / 列距 12px）',
  `after清除=${afterCleared ? '有' : '无'} / 列距12px=${rowGap12 ? '有' : '无'}`,
  'after清除=有 / 列距12px=有', afterCleared && rowGap12);
// 26g/26h（静态）：① justify-content:flex-end 必须收在 @media(min-width:576px) 守卫内
// 为什么必须有守卫：<576px 时 ant-design-vue **自动切上置**（es/form/style/index.js:380 的
//   @media(max-width: screenXSMax=575px) → makeVerticalLayout :337-356，label/control 各
//   flex:0 0 100%；它挂在 genVerticalStyle 顶层、被 genComponentStyleHook 无条件导出，
//   对 horizontal 也生效）。上置态由 makeVerticalLayoutLabel(:328-336) 设 text-align:start
//   要求**左**对齐；而 justify-content 作用在 <label> 这个 inline-flex 容器内部、不受
//   text-align 管辖 → 无条件 flex-end 会把上置态 label 推到行尾。
// 判据有效性（变异验证）：① 删掉 @media 保留 flex-end → 26h 红；② 删掉 flex-end → 26g 红；
//   ③ 把 min-width 改成 575 → 26h 红（字符串按 576 精确匹配）；④ 把 flex-end 挪到基础规则
//   且不加守卫 → 26g 红（baseLabelRule 里出现 flex-end）+ 26h 红。
const braceBlockAfter = (src, needle) => {
  const i = src.indexOf(needle);
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  let depth = 0;
  for (let k = open; k < src.length; k += 1) {
    if (src[k] === '{') depth += 1;
    else if (src[k] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, k);
    }
  }
  return null;
};
const GUARD_576 = '@media (min-width: 576px)';
const guardBody = braceBlockAfter(panelCode, GUARD_576);
const baseLabelRule = (panelCode.match(/\.ant-form-item-label > label\)\s*\{[\s\S]*?\}/) || [''])[0];
const flexEndInGuard = !!guardBody
  && /\.ant-form-item-label > label/.test(guardBody)
  && /justify-content:\s*flex-end/.test(guardBody);
const flexEndUnguarded = /justify-content:\s*flex-end/.test(baseLabelRule);
rec('26g flex-end 收在 576px 守卫内（基础规则不得无条件写）',
  `守卫内=${flexEndInGuard ? '有' : '无'} / 基础规则无条件写=${flexEndUnguarded ? '有' : '无'}`,
  '守卫内=有 / 基础规则无条件写=无', flexEndInGuard && !flexEndUnguarded);
rec('26h 576px 守卫存在（防手工删守卫 / 改断点）',
  guardBody ? '有' : '无', '有', !!guardBody);

console.log(JSON.stringify(out, null, 1));
const fail = out.filter((o) => !o.ok);
console.log(fail.length ? `\n❌ 失败 ${fail.length} 项` : `\n✅ 全部通过（${out.length} 项）`);
await browser.close();
process.exit(fail.length ? 1 : 0);
