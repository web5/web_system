#!/usr/bin/env node
/**
 * 大橙子个人助理小程序 · 一键发布（出码 + 推企业微信 + 上传体验版）
 *
 * 子命令：
 *   node scripts/publish.js preview [--page <page>] [--to <会话名>] [--no-push]
 *       出预览码；默认生成后推企业微信（推给授权人本人，--to 指定会话名）
 *   node scripts/publish.js upload [--to <会话名>] [--notify]
 *       上传体验版到微信后台；--notify 时推一条 markdown 通知
 *   node scripts/publish.js push <二维码png> [--to <会话名>]
 *       把已生成的二维码推送到企业微信
 *
 * 前置：
 *   1. MINIPROGRAM_CI_PATH 指向隔离安装的 miniprogram-ci（见 docs/miniprogram/release-runbook.md §二）
 *   2. wecom-cli 已授权（wecom-cli auth show --status → authorized）
 *   3. 出码机出口 IP 已在公众平台 IP 白名单内（见 release-runbook.md §1.3）
 *
 * 安全约束（本仓库公开）：脚本内不得出现 IP、内部 ID、密钥路径、绝对路径；
 * 目标会话用名字匹配，CI 路径走环境变量，均从本地环境读取。
 */

'use strict';
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ---------- 基础工具 ----------

/** 同步执行命令；inherit 模式把输出直连终端，pipe 模式抓 stdout 字符串 */
function run(cmd, args, opts = {}) {
  return childProcess.execFileSync(cmd, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

/** 调 wecom-cli 并解析 JSON 返回；出错时打印 stderr 后退出 */
function wecom(args) {
  try {
    return JSON.parse(run('wecom-cli', args).trim());
  } catch (e) {
    const err = (e && e.stderr) ? String(e.stderr).trim() : String(e && e.message);
    console.error(`[Publish] wecom-cli 调用失败: ${args.join(' ')}`);
    console.error(err);
    process.exit(1);
  }
}

/** 解析命令行参数 */
function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') opts.to = argv[++i];
    else if (a === '--page') opts.page = argv[++i];
    else if (a === '--no-push') opts.noPush = true;
    else if (a === '--notify') opts.notify = true;
    else opts._.push(a);
  }
  return opts;
}

// ---------- 企业微信推送 ----------

/** 解析推送目标：--to 按会话名精确匹配；缺省取第一个单聊（授权人本人） */
function resolveTarget(toName) {
  const list = wecom(['message', 'aibot', 'sessions', 'list']);
  const sessions = (list && list.sessions) || [];
  if (!sessions.length) {
    console.error('[Publish] ❌ 当前没有可发送的会话（sessions_count=0）');
    process.exit(1);
  }
  if (toName) {
    const hit = sessions.find((s) => s.chat_name === toName);
    if (!hit) {
      const names = sessions
        .map((s) => `  - ${s.chat_name || '(未命名群)'} [${s.chat_type}]`)
        .join('\n');
      console.error(`[Publish] ❌ 未找到会话「${toName}」，可发送会话：\n${names}`);
      process.exit(1);
    }
    return hit;
  }
  const self = sessions.find((s) => s.chat_type === 'single');
  if (!self) {
    console.error('[Publish] ❌ 没有单聊会话，请用 --to <会话名> 指定目标');
    process.exit(1);
  }
  return self;
}

function uploadMedia(filePath) {
  return wecom(['media', 'upload', '--json', JSON.stringify({ file_path: filePath })]);
}

function sendMarkdown(chatId, content) {
  wecom(['message', 'aibot', 'send', '--json', JSON.stringify({
    chat_id: chatId,
    msg_type: 'markdown',
    markdown: { content },
  })]);
}

function sendImage(chatId, mediaId) {
  wecom(['message', 'aibot', 'send', '--json', JSON.stringify({
    chat_id: chatId,
    msg_type: 'image',
    image: { media_id: mediaId },
  })]);
}

/** 把一张二维码图（+ meta 说明）推到企业微信 */
function pushQr(pngPath, toName) {
  if (!fs.existsSync(pngPath)) {
    console.error(`[Publish] ❌ 二维码不存在: ${pngPath}`);
    process.exit(1);
  }
  const target = resolveTarget(toName);
  const label = target.chat_name || '(本人)';
  console.log(`[Publish] 推送到企业微信 → ${label}`);

  const media = uploadMedia(pngPath);

  // 说明文字尽量从 preview.js 产出的 meta 里取（版本/有效期/直达页）
  const metaPath = path.join(path.dirname(pngPath), 'preview-qr.meta.json');
  let head = '小程序预览码（扫码真机体验）';
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    head = [
      `**小程序预览码** v${meta.version}（${meta.gitSha}）`,
      `直达页：${meta.pagePath}`,
      `有效期至 ${meta.expireAtText}（${meta.ttlMinutes} 分钟）`,
      '扫下方二维码真机体验，过期重跑 `npm run publish -- preview`',
    ].join('\n');
  } catch { /* meta 不存在则用兜底文案 */ }

  sendMarkdown(target.chat_id, head);
  sendImage(target.chat_id, media.media_id);
  console.log('[Publish] ✅ 已推送（说明 + 二维码图）');
}

// ---------- 子命令 ----------

function cmdPreview(opts) {
  if (opts.page) process.env.PREVIEW_PAGE = opts.page;
  console.log('[Publish] 出预览码…');
  try {
    run('node', ['scripts/preview.js'], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('[Publish] ❌ 出码失败。最常见原因：本机出口 IP 不在公众平台 IP 白名单');
    console.error('[Publish]    处置：把报错里的 IP 加进 公众平台 → 开发管理 → 开发设置 → IP 白名单');
    process.exit(1);
  }
  if (opts.noPush) {
    console.log('[Publish] 已出码（--no-push，跳过推送）');
    return;
  }
  pushQr(path.join(ROOT, '.ci-output', 'preview-qr.png'), opts.to);
}

function cmdUpload(opts) {
  console.log('[Publish] 上传体验版…');
  try {
    run('node', ['scripts/upload.js'], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    console.error('[Publish] ❌ 上传失败');
    process.exit(1);
  }
  if (opts.notify) {
    const pkg = require(path.join(ROOT, 'package.json'));
    const target = resolveTarget(opts.to);
    sendMarkdown(target.chat_id,
      `**小程序已上传体验版** v${pkg.version}\n请到 公众平台 → 版本管理 设为体验版并提交审核。`);
    console.log('[Publish] ✅ 已上传并推送通知');
  }
}

function cmdPush(opts) {
  pushQr(opts._[0] || path.join(ROOT, '.ci-output', 'preview-qr.png'), opts.to);
}

// ---------- 入口 ----------

function main(argv) {
  const sub = argv[0];
  const opts = parseArgs(argv.slice(1));

  switch (sub) {
    case 'preview':
      cmdPreview(opts);
      break;
    case 'upload':
      cmdUpload(opts);
      break;
    case 'push':
      cmdPush(opts);
      break;
    default:
      console.log([
        '用法:',
        '  node scripts/publish.js preview [--page <page>] [--to <会话名>] [--no-push]',
        '  node scripts/publish.js upload [--notify]',
        '  node scripts/publish.js push <二维码png> [--to <会话名>]',
      ].join('\n'));
      process.exit(0);
  }
}

// 仅作为 CLI 直接运行时才执行；被 require（如单测）时不触发副作用。
if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  parseArgs,
  resolveTarget,
  pushQr,
  uploadMedia,
  sendMarkdown,
  sendImage,
  cmdPreview,
  cmdUpload,
  cmdPush,
  main,
};
