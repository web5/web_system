/**
 * 微信小程序预览脚本（生成开发版二维码）
 * 使用方法: npm run preview
 *
 * 前提条件:
 * 1. private.key 已放在 apps/kedou-ai-minigram/private.key（已 gitignore，切勿入库）
 * 2. 公众平台已把**执行机器**的公网 IP 加入白名单（本地跑加本机，dev 机器跑加 dev 机器）
 * 3. miniprogram-ci 依赖已装
 *
 * 可选环境变量:
 *   PREVIEW_PAGE    预览直达页，默认 pages/chat/index/index
 *   PREVIEW_QUERY   页面参数，如 "id=123"
 *   PREVIEW_SCENE   场景值，默认 1011（扫描二维码）
 *   QRCODE_FORMAT   terminal | image | base64，默认 image
 *   QRCODE_DEST     二维码输出路径，默认 .ci-output/preview-qr.png
 *   PREVIEW_VERSION 覆盖版本号，默认取 package.json 的 version
 *
 * 说明: miniprogram-ci 直连微信后台，**不需要**打开微信开发者工具。
 *       二维码有时效；长期可用请走 npm run upload + 公众平台设为体验版。
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * 依赖加载：默认从干净安装目录（MINIPROGRAM_CI_PATH）加载 miniprogram-ci。
 *
 * 为什么要隔离：本仓库是 pnpm monorepo，根 node_modules/.pnpm/node_modules 里提升的
 * @babel/helper-compilation-targets 与 miniprogram-ci 编译链不兼容，会炸
 *   TypeError: _lruCache is not a constructor
 * 因此在独立目录单独安装一份 miniprogram-ci 再用 MINIPROGRAM_CI_PATH 指过去即可绕过：
 *   mkdir -p ~/mp-ci && cd ~/mp-ci && npm i miniprogram-ci@2.1.31
 *   MINIPROGRAM_CI_PATH=~/mp-ci/node_modules node scripts/preview.js
 */
const CI_ROOT = process.env.MINIPROGRAM_CI_PATH;
const { preview, Project } = require(CI_ROOT
  ? path.join(CI_ROOT, 'miniprogram-ci')
  : 'miniprogram-ci');

const ROOT = path.join(__dirname, '..');
const projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'project.config.json'), 'utf-8'));
const privateKeyPath = path.join(ROOT, 'private.key');

if (!fs.existsSync(privateKeyPath)) {
  console.error('[Preview] 缺少私钥 private.key');
  console.error('[Preview] 请从公众平台下载「小程序代码上传密钥」，保存为 apps/kedou-ai-minigram/private.key');
  process.exit(1);
}

/** git 短 sha，用于 desc 区分每次预览；非 git 环境降级 */
function gitHead() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

async function previewApp() {
  const version = process.env.PREVIEW_VERSION || require('../package.json').version || '1.0.0';
  const qrcodeFormat = process.env.QRCODE_FORMAT || 'image';
  const qrcodeOutputDest = path.resolve(ROOT, process.env.QRCODE_DEST || '.ci-output/preview-qr.png');
  const pagePath = process.env.PREVIEW_PAGE || 'pages/chat/index/index';

  if (qrcodeFormat === 'image') {
    fs.mkdirSync(path.dirname(qrcodeOutputDest), { recursive: true });
  }

  console.log(`[Preview] appid: ${projectConfig.appid}`);
  console.log(`[Preview] 版本: ${version}  直达页: ${pagePath}`);

  try {
    const project = new Project({
      appid: projectConfig.appid,
      type: 'miniProgram',
      projectPath: ROOT,
      privateKey: fs.readFileSync(privateKeyPath),
      privateKeyPath,
      ignores: ['node_modules/**/*', '.ci-output/**/*', 'private.key'],
    });

    const result = await preview({
      project,
      version,
      desc: `${gitHead()} ${new Date().toLocaleString('zh-CN')}`,
      pagePath,
      searchQuery: process.env.PREVIEW_QUERY || '',
      scene: Number(process.env.PREVIEW_SCENE || 1011),
      setting: {
        urlCheck: false,
        es6: true,
        enhance: true,
        postcss: true,
        minified: true,
      },
      qrcodeFormat,
      qrcodeOutputDest,
    });

    console.log('[Preview] 预览成功 ✅');
    if (qrcodeFormat === 'image') {
      console.log(`[Preview] 二维码: ${qrcodeOutputDest}`);
      console.log('[Preview] ⚠️ 二维码有时效，过期重新执行 npm run preview');
      console.log('[Preview] ⚠️ 真机需开「开发调试」，或已在公众平台配置 request 合法域名 https://dev.kedouai.com');
    } else {
      console.log(JSON.stringify(result));
    }
  } catch (error) {
    const msg = error.message || String(error);
    console.error('[Preview] 预览失败:', msg);
    if (/white.?list|ip/i.test(msg)) {
      console.error('[Preview] 排查: 当前机器公网 IP 未在公众平台白名单内');
      console.error('[Preview] 路径: mp.weixin.qq.com → 开发管理 → 开发设置 → IP 白名单');
      console.error('[Preview] 查本机出口 IP: curl -s ifconfig.me');
    } else if (/private key|version/i.test(msg)) {
      console.error('[Preview] 排查: private.key 是否正确 / 版本号是否合规');
    }
    process.exit(1);
  }
}

previewApp();
