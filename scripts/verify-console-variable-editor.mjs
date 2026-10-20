import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserRequire = createRequire(process.env.CONSOLE_BROWSER_RUNTIME ? resolve(process.env.CONSOLE_BROWSER_RUNTIME, 'package.json') : import.meta.url);
const puppeteer = browserRequire('puppeteer-core');
const evidence = process.env.CONSOLE_VAR_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'console-variable-editor-'));
mkdirSync(evidence, { recursive: true, mode: 0o700 });
const entryId = '\0console-variable-entry';
const apiId = '\0console-variable-api';
const entry = `
import { createApp, h, ref } from 'vue';
import Antd, { Drawer } from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import Panel from '/src/components/pipeline/PipelineVarPanel.vue';
const variables=ref([...Array.from({length:55},(_,index)=>({id:'filler-'+index,key:'FILLER_'+index,value:'fixture',isSecret:false,enabled:true})),{id:'last-normal',key:'LAST_NORMAL',value:'complete-fixture-value',description:'ordinary',isSecret:false,enabled:true},{id:'last-secret',key:'LAST_SECRET',value:'********',description:'secret',isSecret:true,enabled:true}]);
const template=ref('fixture-a');
window.__fixture={variables,requests:[],changed:0,failNext:false,delay:120,completed:0,setTemplate:value=>template.value=value};
createApp({setup(){return()=>{const panel=h('div',{id:'fixture-panel'},[h(Panel,{templateId:template.value,vars:variables.value,onChanged:()=>window.__fixture.changed++})]);return new URLSearchParams(location.search).get('surface')==='drawer'?h(Drawer,{open:true,width:640,title:'Fixture drawer'},{default:()=>panel}):h('main',{style:{height:'540px',overflow:'auto',padding:'16px'}},[panel]);}}}).use(Antd).mount('#app');
`;
const api = `
const call=async(operation,id,patch)=>{const fixture=window.__fixture;fixture.requests.push({operation,id,patch:structuredClone(patch)});const fail=fixture.failNext;fixture.failNext=false;await new Promise(resolve=>setTimeout(resolve,fixture.delay));fixture.completed++;if(fail)throw {response:{data:{message:'模拟保存失败'}}};if(operation==='update'){const row=fixture.variables.value.find(row=>row.id===id);Object.assign(row,patch);if(row.isSecret)row.value='********';}return {id};};
export const pipelineVarApi={update:(id,patch)=>call('update',id,patch),create:(id,patch)=>call('create',id,patch),remove:id=>call('remove',id,{})};
`;
const server = await createServer({
  configFile: false,
  root: resolve(repository, 'apps/deploy-console'),
  cacheDir: join(evidence, 'vite-cache'),
  base: '/',
  resolve: { alias: [{ find: '@/api', replacement: 'virtual:console-variable-api' }, { find: '@', replacement: resolve(repository, 'apps/deploy-console/src') }] },
  plugins: [vue(), {
    name: 'console-variable-isolated-fixture',
    resolveId(source) { if (source === '/__console-variable-entry.js') return entryId; if (source === 'virtual:console-variable-api') return apiId; },
    load(id) { if (id === entryId) return entry; if (id === apiId) return api; },
    configureServer(instance) { instance.middlewares.use((request, response, next) => { if (request.url?.split('?')[0] !== '/__console-variable-fixture') return next(); response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body><div id="app"></div><script type="module" src="/__console-variable-entry.js"></script></body></html>'); }); },
  }],
  server: { host: '127.0.0.1', port: 0, fs: { allow: [repository, realpathSync(resolve(repository, 'node_modules'))] } },
});
let browser;
const results = [];
const browserErrors = [];
try {
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await puppeteer.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: 'chrome' }), args: ['--no-sandbox', '--no-proxy-server'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) || /^(data:|blob:)/.test(request.url()) ? request.continue() : request.abort());
  const edit = async id => { await (await page.$('tr[data-row-key="' + id + '"] a')).click(); await page.waitForSelector('.ant-card'); };
  const input = (index, value) => page.$$eval('.ant-card input', (controls, change) => { const control=controls[change.index];control.focus();control.value=change.value;control.dispatchEvent(new Event('input',{bubbles:true})); }, { index, value });
  const save = () => page.$$eval('.ant-card button', buttons => buttons.find(button => /保存|添加/.test(button.textContent.replace(/\s+/g,''))).click());
  const completed = count => page.waitForFunction(expected => window.__fixture.completed >= expected, {}, count);
  const cases = [
    ['长列表编辑可见且聚焦', async surface => { await edit('last-normal');const actual=await page.$eval('.ant-card',card=>{const field=card.querySelectorAll('input')[1],rect=card.getBoundingClientRect();return {title:card.textContent,visible:rect.top>=0&&rect.bottom<=innerHeight,focused:document.activeElement===field};});await page.screenshot({path:join(evidence,surface+'-editor.png')});assert.ok(actual.visible,'编辑表单仍在可视区域之外');assert.ok(actual.focused,'值输入框未聚焦');assert.match(actual.title,/编辑变量/); }],
    ['普通变量回填完整原值', async () => { await edit('last-normal');assert.equal(await page.$$eval('.ant-card input',controls=>controls[1].value),'complete-fixture-value'); }],
    ['普通变量可以显式清空', async () => { await edit('last-normal');await input(1,'');await save();await completed(1);const patch=await page.evaluate(()=>window.__fixture.requests[0].patch);assert.ok(Object.hasOwn(patch,'value'));assert.equal(patch.value,''); }],
    ['密钥不回显且留空保留', async () => { await edit('last-secret');assert.deepEqual(await page.$$eval('.ant-card input',controls=>({value:controls[1].value,type:controls[1].type})),{value:'',type:'password'});await save();await completed(1);assert.equal(await page.evaluate(()=>Object.hasOwn(window.__fixture.requests[0].patch,'value')),false); }],
    ['密钥转普通变量不能公开留存值', async () => { await edit('last-secret');await page.$eval('.ant-card input[type="checkbox"]',control=>control.click());await save();await new Promise(resolve=>setTimeout(resolve,250));assert.equal(await page.evaluate(()=>window.__fixture.requests.length),0);assert.ok(await page.$('.ant-card')); }],
    ['编辑后新增不沿用旧记录身份', async () => { await edit('last-normal');await page.$eval('#fixture-panel > div > div:first-child button',button=>button.click());await page.waitForSelector('.ant-card');assert.equal(await page.$$eval('.ant-card input',controls=>controls[0].value),'');await input(0,'CREATED');await input(1,'new');await save();await completed(1);assert.deepEqual(await page.evaluate(()=>({operation:window.__fixture.requests[0].operation,id:window.__fixture.requests[0].id})),{operation:'create',id:'fixture-a'}); }],
    ['连续保存仅提交一次', async () => { await edit('last-normal');await page.$$eval('.ant-card button',buttons=>{const button=buttons.find(button=>button.textContent.replace(/\s+/g,'').includes('保存'));button.click();button.click();});await completed(1);await new Promise(resolve=>setTimeout(resolve,200));assert.equal(await page.evaluate(()=>window.__fixture.requests.length),1); }],
    ['保存失败保留输入并可重试', async () => { await edit('last-normal');await input(1,'retry-value');await page.evaluate(()=>window.__fixture.failNext=true);await save();await completed(1);assert.equal(await page.$$eval('.ant-card input',controls=>controls[1].value),'retry-value');await save();await completed(2);await page.waitForFunction(()=>!document.querySelector('.ant-card'));assert.equal(await page.evaluate(()=>window.__fixture.changed),1); }],
    ['切换流水线后旧保存不刷新新上下文', async () => { await edit('last-normal');await page.evaluate(()=>window.__fixture.delay=350);await save();await page.evaluate(()=>window.__fixture.setTemplate('fixture-b'));await completed(1);await new Promise(resolve=>setTimeout(resolve,100));assert.equal(await page.evaluate(()=>window.__fixture.changed),0);assert.equal(await page.$('.ant-card'),null); }],
  ];
  for (const surface of ['page', 'drawer']) for (const [name, test] of cases) {
    try { await page.goto(origin+'/__console-variable-fixture?surface='+surface,{waitUntil:'networkidle0',timeout:90000});await page.waitForSelector('tr[data-row-key="last-normal"]');await test(surface);results.push({surface,name,passed:true}); }
    catch (error) { results.push({surface,name,passed:false,error:error.message}); }
  }
  assert.deepEqual(browserErrors,[],'浏览器存在运行时错误');
} finally {
  if (browser) await browser.close();
  await server.close();
}
writeFileSync(join(evidence,'results.json'),JSON.stringify({results,browserErrors},null,2),{mode:0o600});
const failures=results.filter(result=>!result.passed);
console.log(JSON.stringify({total:results.length,passed:results.length-failures.length,failures,evidence},null,2));
process.exitCode=failures.length?1:0;
