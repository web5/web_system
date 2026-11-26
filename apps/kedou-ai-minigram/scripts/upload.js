/**
 * 微信小程序上传脚本
 * 使用方法: npm run upload
 *
 * 🔴 出码前门禁（P1–P6）在**本文件第一行代码**就执行（台账 9136）：
 *    判据实现只有仓库根共享层 `scripts/lib/miniprogram-preflight.js` 一份（与大橙子共用），
 *    本文件不再自带任何判据、也不另存一份 preflight.js。
 *    直连 `node scripts/upload.js` 与走 `npm run upload` 过的是同一道门。
 *    逃生口：--skip-preflight / --allow-any-dir / --expect-version / --expect-sha / --require-dir。
 *
 * 前提条件:
 * 1. 安装微信开发者工具
 * 2. 在微信开发者工具中登录并开启服务端口
 * 3. 在项目根目录创建 private.key 私钥文件（从微信公众平台下载）
 * 4. 小程序已发布过正式版本
 */

const path = require('path');
const fs = require('fs');
const preflight = require('../../../scripts/lib/miniprogram-preflight');

/* ---------- 0. 出码前门禁：本文件的**第一条动作**（台账 9136） ----------
 *
 * 🔴 本文件是「上传开发版本」这件事的真载体：谁调它都过**同一道门禁** —— 直接
 *    `node scripts/upload.js`、经 npm 入口、还是经别的包装脚本，走的都是这一处。
 *
 * 🔴 为什么排在加载 miniprogram-ci / 读 project.config.json / 读 private.key 之前：
 *    门禁若排在「读私钥」之后，缺私钥的场景会先报「缺少私钥」而看不到真正的雷
 *    （站错目录 / 版本不对 / 包根带私钥）。
 *
 * 🔴 判据不在这里：只在共享层 miniprogram-preflight 一份（P1–P6）；「哪些入口要过门禁」的
 *    清单见共享层文件头与 tests/preflight-wiring.test.ts。本文件只调用、打印、失败即退，
 *    不带自己的判据（复制即违规）。⚠️ 别在注释里写「哪条路仍绕过」这类清单 —— 那种清单必然过期。
 *
 * 🔴 防重复执行：上游会以 MINIPROGRAM_PREFLIGHT_GATE=done 声明「已跑过」，
 *    此时只打一行痕、不重复判定（同一链上只要一份报表）。
 */
const gateOpts = preflight.parsePreflightArgs(process.argv.slice(2));
// 上传根就是本包：不接受 --root 把门禁指到别处（门禁查的根必须 == 出码的根）
delete gateOpts.root;
gateOpts.root = path.join(__dirname, '..');
// 本文件走 miniprogram-ci：mode 固定 ci（P2 允许包根私钥但要求 ignore 覆盖，P6 不判开发者工具）
gateOpts.mode = 'ci';
// 🔴 版本真源：本包**没有**编译期版本常量（版本真源只有 package.json），理由与 preview.js 同一段注释。
//    P1 仍核 package.json.version 存在，且（给了 --expect-version 时）必须等于期望版本。
gateOpts.versionSources = [];
preflight.runGateOrExit(gateOpts, 'upload');

/**
 * 依赖加载：默认从干净安装目录（MINIPROGRAM_CI_PATH）加载 miniprogram-ci。
 *
 * 为什么要隔离：本仓库是 pnpm monorepo，根提升的 @babel/helper-compilation-targets
 * 与 miniprogram-ci 编译链不兼容，会炸 TypeError: _lruCache is not a constructor。
 * 解决：在独立目录单独安装一份，再用 MINIPROGRAM_CI_PATH 指过去：
 *   mkdir -p ~/mp-ci && cd ~/mp-ci && npm i miniprogram-ci@2.1.31
 *   MINIPROGRAM_CI_PATH=~/mp-ci/node_modules node scripts/upload.js
 */
const CI_ROOT = process.env.MINIPROGRAM_CI_PATH;
const { upload, Project } = require(CI_ROOT
  ? path.join(CI_ROOT, 'miniprogram-ci')
  : 'miniprogram-ci');

// 读取配置
const projectConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../project.config.json'), 'utf-8'));
const privateKeyPath = path.join(__dirname, '../private.key');
const privateKey = fs.existsSync(privateKeyPath) ? fs.readFileSync(privateKeyPath) : null;

/**
 * 读取 app.json 中全部注册页面（含分包）。
 * ⚠️ 注意：pages 字段在 app.json，project.config.json 里没有（别读错了会拿到空数组，校验形同虚设）。
 */
function readRegisteredPages() {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'), 'utf-8'));
  const pages = [...(appJson.pages || [])];
  // root 无尾斜杠（如 "packageTranslate"），page 无前导斜杠（如 "pages/xxx"），需自行补 /
  (appJson.subPackages || appJson.subpackages || []).forEach((sp) => {
    (sp.pages || []).forEach((p) => pages.push(`${(sp.root || '').replace(/\/$/, '')}/${p}`));
  });
  return pages;
}

async function uploadApp() {
  const projectPath = path.join(__dirname, '..');
  
  if (!privateKey) {
    console.error('[Upload] 缺少私钥文件，请将私钥保存为 private.key');
    process.exit(1);
  }

  // 从 package.json 读取版本号
  const packageJson = require('../package.json');
  const version = packageJson.version || '1.0.0';

  // 上传前校验 app.json 注册的每个页面都有实体文件。
  // 注册了幽灵页会在真机「页面不存在」白屏（扫码直达路径填错时同样症状）。
  const registered = readRegisteredPages();
  // 页面路径末段是文件名（pages/welcome/index/index → 目录 pages/welcome/index/ + 文件 index.*）
  // 源码是 TypeScript，index.js 由 CI 编译产出，故 .ts / .js 二者有一即可。
  const missing = registered.filter((p) => {
    const dir = path.join(projectPath, path.dirname(p));
    const name = path.basename(p);
    const hasLogic =
      fs.existsSync(path.join(dir, `${name}.ts`)) || fs.existsSync(path.join(dir, `${name}.js`));
    const hasTpl = fs.existsSync(path.join(dir, `${name}.wxml`));
    return !hasLogic || !hasTpl;
  });
  if (missing.length > 0) {
    console.error('[Upload] ❌ 以下注册页面缺少实体文件（index.ts/.js 或 index.wxml）:');
    missing.forEach((p) => console.error(`    ${p}`));
    process.exit(1);
  }
  console.log(`[Upload] 页面实体校验通过（${registered.length} 个注册页面）`);
  
  // miniprogram-ci 约定：先构造 Project 实例，再作为 upload({ project }) 传入。
  // 直接把配置展开进 upload 参数会报 lack of parameter: "project"。
  const project = new Project({
    appid: projectConfig.appid,
    type: 'miniProgram',
    projectPath,
    privateKey,
    privateKeyPath,
    ignores: ['node_modules/**/*'],
  });

  try {
    console.log('[Upload] 开始上传...');
    console.log(`[Upload] 版本号: ${version}`);

    const uploadResult = await upload({
      project,
      version,
      desc: `上传时间: ${new Date().toLocaleString('zh-CN')}`,
      setting: {
        urlCheck: false,
        es6: true,
        enhance: true,
        postcss: true,
        minified: true,
      },
    });

    console.log('[Upload] 上传成功!');
    console.log(`[Upload] 上传后版本: ${uploadResult.version}`);
    console.log(`[Upload] 后台入口页 = pages[0] = ${registered[0] || '(未知)'}`);
    console.log('[Upload] ⚠️ 生成体验版二维码时请用系统标准码，勿手填 path ——');
    console.log('[Upload]    手填不存在或已改名的页面会导致扫码「页面不存在」白屏（本次事故根因）');
    console.log('[Upload] 请到微信公众平台提交审核');
  } catch (error) {
    console.error('[Upload] 上传失败:', error.message);
    if (error.message.includes('private key')) {
      console.log('[Upload] 请确保:');
      console.log('   1. 已在项目根目录创建 private.key 文件');
      console.log('   2. 私钥文件内容正确');
      console.log('   3. 已在微信公众平台配置项目成员');
    }
    process.exit(1);
  }
}

uploadApp();
