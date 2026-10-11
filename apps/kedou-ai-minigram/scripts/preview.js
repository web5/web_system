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
 *   PREVIEW_TTL_MIN 预览码有效期（分钟），默认 25
 *
 * 说明: miniprogram-ci 直连微信后台，**不需要**打开微信开发者工具。
 *       二维码有时效（官方口径 25 分钟）；长期可用请走 npm run upload + 公众平台设为体验版
 *       （体验版码官方口径 7 天）。
 *
 * 产物（qrcodeFormat=image 时）：
 *   preview-qr.png            二维码原图（固定名，便于脚本 scp）
 *   preview-qr-<v>-<HHMM>.png 同上副本，文件名带生成时刻，便于在下载目录里挑最新的
 *   preview-qr.html           自包含卡片：内嵌原图 + 有效期至 + 实时倒计时（可直接扫码）
 *   preview-qr.meta.json      机器可读的过期信息（CI/脚本据此判断是否已失效）
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

/** 预览码有效期（分钟）。微信官方口径：开发工具/CI 预览码 25 分钟，过期即扫不出来。
 *  实测偶有更长，但按最短口径标注才不会误导 —— 可用 PREVIEW_TTL_MIN 覆盖。 */
const TTL_MIN = Number(process.env.PREVIEW_TTL_MIN || 25);

/** 本地时间格式化：2026-10-11 23:58:01（不依赖 toLocaleString，避免执行机 locale 差异） */
function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 生成一个自包含的 HTML 预览页（二维码以 data URI 内嵌）+ 过期倒计时。
 *
 * 为什么要有它：二维码图片直接丢进聊天/IM 会被转码压缩，压缩后手机常常扫不出来；
 * 而一个本地 HTML 打开就是原图，点击即可扫。
 *
 * 为什么要有倒计时：过去只写「有时效」，用户拿到图不知道还能扫多久，扫不出来时
 * 无法区分「码过期」和「包有问题」——后者会引发一整轮无谓的白屏排查。
 * 现在过期时刻 + 剩余秒数直接写在码旁边，过期后整卡片转灰并提示重跑。
 *
 * ⚠️ 必须 sniff 真实格式：微信 CI 的 qrcodeOutputDest 写出的文件**扩展名是 .png
 * 但内容是 JPEG**，若照扩展名写 data:image/png，浏览器会解析失败显示不出图。
 */
function writeQrHtml(imgPath, meta) {
  try {
    const buf = fs.readFileSync(imgPath);
    const isPng = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50;
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const b64 = buf.toString('base64');
    const dest = path.join(path.dirname(imgPath), 'preview-qr.html');
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>小程序预览码 v${meta.version}</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:#FFF8F0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1a1a1a;padding:24px}
.card{background:#fff;border-radius:28px;padding:28px 36px 32px;box-shadow:0 12px 40px rgba(23,23,23,.10);text-align:center;max-width:520px;transition:filter .3s}
.title{font-size:13px;letter-spacing:.14em;color:#F97316;font-weight:700;margin-bottom:2px}
.sub{font-size:20px;font-weight:700;margin:0 0 16px}
img{width:400px;height:400px;display:block;margin:0 auto;border-radius:18px;background:#fff;transition:filter .3s}
.meta{font-size:12.5px;color:#8A90A0;margin:16px 0 0;line-height:1.9}
.exp{margin:14px 0 8px;font-size:13px;color:#6B7280}
.exp b{font-size:17px;color:#1a1a1a;font-variant-numeric:tabular-nums;margin-left:6px}
.cd{display:inline-block;margin-top:6px;padding:7px 18px;border-radius:999px;background:#F97316;color:#fff;
font-size:16px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.cd.warn{background:#EF4444}
.cd.over{background:#9CA3AF}
.tip{font-size:12px;color:#8A90A0;margin-top:16px;line-height:1.8}
.over-mask{position:relative}
.card.is-over{filter:grayscale(.85) opacity(.72)}
.card.is-over .cd{background:#9CA3AF}
</style></head><body>
<div class="card" id="card">
  <div class="title">KEDOU AI · 开发版预览码</div>
  <div class="sub">v${meta.version} · ${meta.gitSha}</div>
  <div class="over-mask"><img src="data:${mime};base64,${b64}" alt="预览码"></div>
  <div class="meta">直达 ${meta.pagePath}<br>生成于 ${meta.createdAtText}</div>
  <div class="exp">有效期至<b>${meta.expireAtText}</b>（${meta.ttlMinutes} 分钟）</div>
  <div class="cd" id="cd">剩余 --:--</div>
  <div class="tip">过期后需重跑 <code>npm run preview</code>；<br>扫码不出来先看清这里是「已过期」还是真故障。</div>
</div>
<script>
var EXPIRE = ${meta.expireAtMs};
var el = document.getElementById('cd');
var card = document.getElementById('card');
function tick(){
  var left = EXPIRE - Date.now();
  if (left <= 0) {
    el.textContent = '已过期 · 请重新生成';
    el.className = 'cd over';
    card.classList.add('is-over');
    return;
  }
  var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  el.textContent = '剩余 ' + m + ':' + (s < 10 ? '0' : '') + s;
  el.className = 'cd' + (left < 300000 ? ' warn' : '');
  setTimeout(tick, 1000);
}
tick();
</script>
</body></html>`;
    fs.writeFileSync(dest, html);
    return dest;
  } catch (e) {
    return '(HTML 预览页生成失败: ' + e.message + ')';
  }
}

/**
 * 写机器可读的过期信息，供 CI / scp 脚本判断是否已失效。
 * 有了它就不用「人肉记住几点几分生成的」。
 */
function writeQrMeta(imgPath, meta) {
  try {
    const dest = path.join(path.dirname(imgPath), 'preview-qr.meta.json');
    fs.writeFileSync(dest, JSON.stringify(meta, null, 2) + '\n');
    return dest;
  } catch {
    return '(meta 写入失败)';
  }
}

/**
 * 读取 app.json 中全部注册页面（含分包）。
 * ⚠️ 注意：pages 字段在 app.json，project.config.json 里没有（别读错了会拿到空数组）。
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

async function previewApp() {
  const version = process.env.PREVIEW_VERSION || require('../package.json').version || '1.0.0';
  const qrcodeFormat = process.env.QRCODE_FORMAT || 'image';
  const qrcodeOutputDest = path.resolve(ROOT, process.env.QRCODE_DEST || '.ci-output/preview-qr.png');
  const pagePath = process.env.PREVIEW_PAGE || 'pages/welcome/index/index';

  // 直达页合法性校验：pagePath 必须是 app.json 里注册过的页面。
  // 历史上在后台手填过不存在的 pages/index/index，扫码冷启动直接「页面不存在」白屏。
  const registered = readRegisteredPages();
  if (!registered.includes(pagePath)) {
    console.error(`[Preview] ❌ pagePath 未在 app.json 注册: ${pagePath}`);
    console.error('[Preview] 可用页面（app.json pages）:');
    registered.forEach((p) => console.error(`    ${p}`));
    process.exit(1);
  }

  if (qrcodeFormat === 'image') {
    fs.mkdirSync(path.dirname(qrcodeOutputDest), { recursive: true });
  }

  console.log(`[Preview] appid: ${projectConfig.appid}`);
  console.log(`[Preview] 版本: ${version}  直达页: ${pagePath}`);

  // 生成时刻 = 调 preview 之前：微信后台的时效从这里起算，取成功后再取时间会偏保守一点点，
  // 但宁可偏短 —— 标长了用户会以为还能扫。
  const sha = gitHead();
  const createdAtMs = Date.now();
  const createdAt = new Date(createdAtMs);
  const expireAtMs = createdAtMs + TTL_MIN * 60 * 1000;
  const expireAt = new Date(expireAtMs);
  const meta = {
    appid: projectConfig.appid,
    version,
    gitSha: sha,
    pagePath,
    createdAt: createdAt.toISOString(),
    createdAtText: fmt(createdAt),
    expireAt: expireAt.toISOString(),
    expireAtText: fmt(expireAt),
    expireAtMs,
    ttlMinutes: TTL_MIN,
    hint: '预览码过期后必须重新生成；需要长期可用的码请走 upload + 公众平台体验版（官方口径 7 天）',
  };

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
      // desc 在微信后台「开发版本」列表可见；把有效期写进去，后台也能一眼看出这个码还能不能用
      desc: `${sha} ${fmt(createdAt)} (有效期至 ${fmt(expireAt)})`,
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
      const htmlPath = writeQrHtml(qrcodeOutputDest, meta);
      const metaPath = writeQrMeta(qrcodeOutputDest, meta);
      // 带生成时刻的副本：下载目录里堆了多个 preview-qr.png 时，看文件名就知道哪个最新
      const stamp = `${fmt(createdAt).slice(5, 10).replace('-', '')}-${fmt(createdAt).slice(11, 13)}${fmt(createdAt).slice(14, 16)}`;
      let stamped = path.join(path.dirname(qrcodeOutputDest), `preview-qr-v${version}-${stamp}.png`);
      try {
        fs.copyFileSync(qrcodeOutputDest, stamped);
      } catch (e) {
        stamped = `(副本写入失败: ${e.message})`;
      }

      console.log('');
      console.log(`[Preview] ⏳ 生成于 ${meta.createdAtText}`);
      console.log(`[Preview] ⏳ 有效期至 ${meta.expireAtText}  （${TTL_MIN} 分钟，PREVIEW_TTL_MIN 可覆盖）`);
      console.log(`[Preview] 二维码: ${qrcodeOutputDest}`);
      console.log(`[Preview] 带时间戳副本: ${stamped}`);
      console.log(`[Preview] 过期信息(meta): ${metaPath}`);
      console.log(`[Preview] 可扫码卡片: ${htmlPath}`);
      console.log('[Preview]   → 打开它就能用手机扫（内嵌原图，不经聊天工具转码压缩，带剩余时间倒计时）');
      console.log('[Preview] ⚠️ 过期重跑 npm run preview；需要长期码请走 upload + 体验版');
      console.log('[Preview] ⚠️ 真机需开「开发调试」，或已在公众平台配置 request 合法域名 https://dev.kedouai.com');
    } else {
      console.log(JSON.stringify({ ...result, expireAt: meta.expireAt, expireAtText: meta.expireAtText }));
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
