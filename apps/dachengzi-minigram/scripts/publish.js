#!/usr/bin/env node
/**
 * 大橙子个人助理小程序 · 出码 / 推企业微信 / 上传开发版本 / 版本指引
 *
 * 子命令：
 *   node scripts/publish.js preview [--page <page>] [--to <会话名>] [--no-push] [--mode cli|ci]
 *       出预览码；默认生成后推企业微信（推给第一个群，如公司群；--to 指定会话名）。
 *       默认 cli 模式（微信开发者工具 CLI，走登录态，免 IP 白名单）。
 *   node scripts/publish.js upload [--desc <文本>] [--to <会话名>] [--notify] [--mode cli|ci]
 *       上传开发版本（脚本到此为止）；--notify 时推一条 markdown 通知。
 *       --desc 自定义「开发版本描述」（公众平台开发版本列表里的备注），支持
 *       `--desc 首页动态问候` 与 `--desc=首页动态问候` 两种写法：
 *         · 不传 → 保持默认 `cli 上传 v<版本> @ <sha>`（与历史完全一致）
 *         · 传了 → `<文本> | v<版本> @ <sha>`（版本与 sha 一律保留，便于审计）
 *       换行/制表符压成单空格；全文超 60 字符截断自定义文本并打印一行提示。
 *       仅 cli 模式生效（ci 模式描述由 upload.js 自行生成）。
 *       例：node scripts/publish.js upload --desc 首页动态问候 --notify
 *   node scripts/publish.js push <二维码png> [--to <会话名>]
 *       把已生成的二维码推送到企业微信。
 *   node scripts/publish.js trial
 *       打印「设为体验版」人工分步指引（纯打印，零副作用）。
 *   node scripts/publish.js release
 *       打印「提交审核 → 发布正式版」人工分步指引（纯打印，零副作用）。
 *
 * 🔴 边界：本脚本只到「上传开发版本」为止；设为体验版 / 提交审核 / 发布须人工在
 *    微信公众平台操作，微信不向自建小程序开放对应接口，脚本不代做、也不会自称已推进。
 *
 * 🔴 出码前检查（preflight，见 scripts/preflight.js）：
 *    preview / upload 两个子命令的**第一步**就跑四项硬检查 ——
 *      P1 版本真实性（package.json.version == utils/version.ts 的 APP_VERSION，缺 version.ts 即失败）
 *      P2 私钥不入包（包根出现 *.key / *.pem → 硬失败，P0 安全项）
 *      P3 工作区身份（打印分支@sha；给了 --expect-sha 就核对，不符即失败）
 *      P4 目录白名单提示（不在 web_system-<任务号> 命名内 → 只警告）
 *    失败即 exit 1，**先于任何 CLI 调用**；push / trial / release 三个子命令不受影响。
 *    --skip-preflight 显式跳过（打印「已跳过出码前检查，风险自负」），只留给已知异常场景。
 *    起因：web_system-dachengzi 这个分支名叫 devtools/dachengzi-preview 的 worktree 里
 *    躺着 1.0.14 的代码 + 一个真 private.key —— 一次「顺手出个预览码」就是旧包 + 私钥外发。
 *
 * 前置：
 *   cli 模式（默认，免 IP 白名单）：
 *     1. 微信开发者工具已登录（cli islogin → {"login":true}）
 *     2. WECHAT_DEVTOOLS_CLI 指向开发者工具 CLI 二进制，或 cli 已在 PATH 中
 *   ci 模式（--mode ci，需 IP 白名单）：
 *     1. MINIPROGRAM_CI_PATH 指向隔离安装的 miniprogram-ci（见 release-runbook §二）
 *     2. 出码机出口 IP 已在公众平台 IP 白名单内（见 release-runbook §1.3）
 *   wecom-cli 已授权（wecom-cli auth show --status → authorized）
 *
 * 安全约束（本仓库公开）：脚本内不得出现 IP、内部 ID、密钥路径、绝对路径；
 * 目标会话用名字匹配，CI/CLI 路径走环境变量，均从本地环境读取。
 */

'use strict';
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const preflight = require('./preflight');

const ROOT = path.join(__dirname, '..');
const CI_OUT = path.join(ROOT, '.ci-output');
// 预览码有效期（分钟），与 preview.js 的默认口径一致（微信官方口径 25 分钟）
const PREVIEW_TTL_MIN = 25;
// 上传描述（开发版本备注）总长上限。微信官方未公布 desc 的硬上限
// （ci.upload 的 desc 只标「自定义备注」、cli upload -d 只标「备注」），
// 故按团队保守阈值自限 60 字符：超长截断自定义文本并打印一行提示，见 buildUploadDesc。
const DESC_MAX_LEN = 60;
// 默认直达页（app.json 注册的首页）。cli preview 出的是默认入口页二维码，不接收直达页参数。
const DEFAULT_PAGE = 'pages/home/index/index';

// ---------- 文案常量（§3 原文，单一真源；单测与文档据此对齐，不得自行改写） ----------

/** §3.1 upload --notify 企业微信通知。version 取运行时 package.json.version */
function NOTIFY_UPLOAD(version) {
  return [
    `**小程序已上传开发版本** v${version}`,
    '> 脚本到此为止。设为体验版 / 提交审核 / 发布须在微信公众平台人工操作，脚本不代做。',
    '',
    `**体验版**（可选，连 prod）：公众平台 → 管理 → 版本管理 → 开发版本 → 选 v${version} → 设为体验版；体验成员在「成员管理 → 体验成员」添加；体验版二维码请用系统标准码，勿手填 path。`,
    '**正式版**（连 prod）：公众平台 → 管理 → 版本管理 → 开发版本 → 提交审核（填类目 / 测试账号 / 备注）→ 审核通过 → 点击发布（全量或分阶段）。',
    '',
    '分步指引：npm run publish -- trial ｜ npm run publish -- release',
  ].join('\n');
}

/** §3.2 trial 子命令输出（纯打印，零副作用） */
function GUIDE_TRIAL(version) {
  return [
    `[Publish] 体验版设置指引 · v${version}`,
    '🔴 本脚本不操作微信公众平台，以下均为人工步骤。',
    '',
    '【前置检查】',
    `  · package.json 版本已递增（当前 v${version}；微信要求递增，重复会被拒）`,
    '  · 开发版本已上传：若未上传，先跑 npm run publish -- upload',
    '  · 体验成员已添加：公众平台 → 管理 → 成员管理 → 体验成员',
    '  · 体验版连 https://kedouai.com（prod），请在 request 合法域名登记',
    '',
    '【人工步骤】',
    '  1. 登录 https://mp.weixin.qq.com/ → 管理 → 版本管理 → 开发版本',
    `  2. 选中 v${version} → 点击「设为体验版」`,
    '  3. 用系统生成的标准二维码，勿手填 path（手填不存在/改名页面会扫码白屏）',
    '  4. 体验版二维码有效期以微信侧为准（官方口径 7 天）',
    '',
    '【验收】体验成员扫码，验证气泡对话 / NCE 书籍列表 / 头像昵称同步',
    '【下一步】正式版：npm run publish -- release',
  ].join('\n');
}

/** §3.3 release 子命令输出（纯打印，零副作用） */
function GUIDE_RELEASE(version) {
  return [
    `[Publish] 正式版发布指引 · v${version}`,
    '🔴 本脚本不操作微信公众平台，以下均为人工步骤。',
    '',
    '【前置检查】',
    '  · 体验版已真机验收通过',
    '  · prod 后端已发布：https://kedouai.com',
    '  · request 合法域名已登记 dev.kedouai.com 与 kedouai.com',
    '  · AppSecret 已同步；隐私指引已声明并发布',
    `  · package.json 版本已递增（当前 v${version}）`,
    '',
    '【人工步骤】',
    '  1. 登录 https://mp.weixin.qq.com/ → 管理 → 版本管理 → 开发版本 → 提交审核',
    '  2. 填写类目 / 测试账号 / 备注；审核时长以微信侧为准',
    '  3. 若驳回：按驳回原因修改 → 重新上传开发版本 → 重新提审',
    '  4. 审核通过 → 点击「发布」（全量或分阶段灰度）',
    '  5. 发布后真机验证：正式版连 prod，不打到 dev',
    '',
    '【回滚】公众平台 → 管理 → 版本管理 → 线上版本 → 版本回退（回到上一线上版本）；',
    '        审核中可在「审核版本」区撤回审核。',
    '【环境】正式版/体验版连 https://kedouai.com（prod）；开发版连 dev。',
  ].join('\n');
}

/** §3.4 cmdUpload 控制台指引（不带 --notify 时也打印；upload.js 复用） */
function GUIDE_UPLOAD_CONSOLE(version) {
  return [
    `[Publish] ✅ 开发版本 v${version} 已上传到公众平台后台。`,
    '🔴 脚本到此为止：设为体验版 / 提交审核 / 发布均为人工操作，脚本不代做。',
    '   体验版指引：npm run publish -- trial',
    '   正式版指引：npm run publish -- release',
  ].join('\n');
}

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
    else if (a === '--mode') opts.mode = argv[++i];
    else if (a === '--desc') opts.desc = argv[++i];
    else if (a.startsWith('--desc=')) opts.desc = a.slice('--desc='.length);
    else if (a === '--no-push') opts.noPush = true;
    else if (a === '--notify') opts.notify = true;
    else if (a === '--skip-preflight') opts.skipPreflight = true;
    else if (a === '--expect-sha') opts.expectSha = argv[++i];
    else if (a.startsWith('--expect-sha=')) opts.expectSha = a.slice('--expect-sha='.length);
    else if (a === '--require-dir') opts.requireDir = argv[++i];
    else if (a.startsWith('--require-dir=')) opts.requireDir = a.slice('--require-dir='.length);
    else if (a === '--allow-dirty') opts.allowDirty = true;
    else opts._.push(a);
  }
  return opts;
}

/** 出码模式：cli（默认，免白名单）| ci（miniprogram-ci，需白名单） */
function resolveMode(mode) {
  if (mode === undefined || mode === '') return 'cli';
  if (mode === 'cli' || mode === 'ci') return mode;
  console.error(`[Publish] ❌ 未知 --mode「${mode}」，仅支持 cli|ci（默认 cli）`);
  process.exit(1);
}

// ---------- 企业微信推送 ----------

/** 解析推送目标：--to 按会话名精确匹配；缺省取第一个群（如公司群），无群回退第一个单聊 */
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
  const group = sessions.find((s) => s.chat_type === 'group');
  if (group) return group;
  const self = sessions.find((s) => s.chat_type === 'single');
  if (self) return self;
  console.error('[Publish] ❌ 没有群或单聊会话，请用 --to <会话名> 指定目标');
  process.exit(1);
}

/**
 * 校验 wecom-cli send/upload 返回体：success 必须为 true，否则打印 errmsg/errcode 后退出。
 * 返回体顶层可能带 security_notice / extra_identity_context 等字段，此处只取业务字段，
 * 不误判。校验通过则原样返回 res 供调用方读取 media_id 等字段。
 */
function assertWecomOk(res, action) {
  if (res && res.success === true) return res;
  const parts = [];
  if (res && res.errmsg != null && res.errmsg !== '') parts.push(String(res.errmsg));
  if (res && res.errcode != null) parts.push(`errcode=${res.errcode}`);
  const reason = parts.length ? parts.join('，') : '未返回 success=true';
  console.error(`[Publish] ❌ ${action}失败：${reason}`);
  process.exit(1);
}

function uploadMedia(filePath, type = 'image') {
  // media upload 的返回体是 {type, media_id, created_at}，没有 success 字段，
  // 不能套用 assertWecomOk（其 success 语义只适用于 message aibot send）。
  // 这里以「media_id 存在且非空」作为成功判据；失败时打印 errmsg/errcode（有则带）并退出。
  const res = wecom(['media', 'upload', '--json', JSON.stringify({ file_path: filePath, type })]);
  if (res && res.media_id) return res;
  const parts = [];
  if (res && res.errmsg != null && res.errmsg !== '') parts.push(String(res.errmsg));
  if (res && res.errcode != null) parts.push(`errcode=${res.errcode}`);
  const reason = parts.length ? parts.join('，') : '未返回 media_id';
  console.error(`[Publish] ❌ 上传媒体失败：${reason}`);
  process.exit(1);
}

function sendMarkdown(chatId, content) {
  const res = wecom(['message', 'aibot', 'send', '--json', JSON.stringify({
    chat_id: chatId,
    msg_type: 'markdown',
    markdown: { content },
  })]);
  return assertWecomOk(res, '发送 markdown');
}

function sendImage(chatId, mediaId) {
  const res = wecom(['message', 'aibot', 'send', '--json', JSON.stringify({
    chat_id: chatId,
    msg_type: 'image',
    image: { media_id: mediaId },
  })]);
  return assertWecomOk(res, '发送 image');
}

/** 把一张二维码图（+ meta 说明）推到企业微信 */
function pushQr(pngPath, toName) {
  if (!fs.existsSync(pngPath)) {
    console.error(`[Publish] ❌ 二维码不存在: ${pngPath}`);
    process.exit(1);
  }
  const target = resolveTarget(toName);
  const label = target.chat_name || '(未命名会话)';
  console.log(`[Publish] 推送到企业微信 → ${label}`);

  const media = uploadMedia(pngPath, 'image');

  // 说明文字一行：版本 + 有效期，从 png 同名的 meta 里取。
  // meta 文件名由 png 文件名派生：preview-qr.png → preview-qr.meta.json，
  // cli-preview-qr.png → cli-preview-qr.meta.json。
  const metaPath = path.join(
    path.dirname(pngPath),
    path.basename(pngPath, path.extname(pngPath)) + '.meta.json',
  );
  let head = '小程序开发版预览二维码（扫码体验）';
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    head = `小程序开发版预览二维码 v${meta.version} · 有效期至 ${meta.expireAtText}`;
  } catch { /* meta 不存在则用兜底文案 */ }

  sendMarkdown(target.chat_id, head);
  sendImage(target.chat_id, media.media_id);
  console.log('[Publish] ✅ 已推送（说明 + 二维码图）');
}

// ---------- cli 出码（微信开发者工具，免 IP 白名单） ----------

/**
 * 解析开发者工具 CLI 二进制：优先环境变量 WECHAT_DEVTOOLS_CLI；
 * 未设则回退 PATH 里的 cli 命令（which cli）；再找不到返回字面量 'cli'，
 * 由后续 execFileSync 以「spawn cli ENOENT」的形式给出可读错误。
 */
function resolveCliBinary(env = process.env) {
  if (env && env.WECHAT_DEVTOOLS_CLI) return env.WECHAT_DEVTOOLS_CLI;
  try {
    const found = run('which', ['cli']).trim();
    if (found) return found;
  } catch { /* cli 不在 PATH */ }
  return 'cli';
}

/**
 * 拼 cli 调用失败时的「真实错误」信息，供 catch 分支原样打印。
 *
 * 修的是什么：WECHAT_DEVTOOLS_CLI 未设时 resolveCliBinary 会回退成字面量 'cli'，
 * spawn('cli') 抛 ENOENT；旧 catch 只打三条通用排查提示，看不到 code / stderr，
 * 「缺环境变量」被读成「出码失败」，历史上按「开发者工具未登录」白排查过。
 * 这里把三件事打出来：e.stderr（有内容时）、e.code、WECHAT_DEVTOOLS_CLI 是否已设置。
 *
 * 纯函数：不打印、不读 process.env（env 可注入），只返回多行文本；
 * 退出码与成功路径均不受影响（调用方只多做一次 console.error）。
 */
function describeCliError(e, env = process.env) {
  const lines = [];
  const stderr = e && e.stderr != null ? String(e.stderr).trim() : '';
  const message = e && e.message != null ? String(e.message).trim() : '';
  if (stderr) lines.push(`   真实报错：${stderr}`);
  else if (message) lines.push(`   真实报错：${message}`);

  const code = e && e.code != null && e.code !== '' ? String(e.code) : '';
  if (code) lines.push(`   错误码：${code}`);

  const cliSet = !!(env && env.WECHAT_DEVTOOLS_CLI);
  if (cliSet) {
    lines.push('   WECHAT_DEVTOOLS_CLI：已设置');
    if (code === 'ENOENT') {
      lines.push('   归位：ENOENT = 该路径下找不到可执行文件，检查 WECHAT_DEVTOOLS_CLI 指向的 cli 是否存在');
    }
  } else {
    lines.push('   WECHAT_DEVTOOLS_CLI：未设置 —— 此时回退成字面量 cli，spawn 报 ENOENT；');
    lines.push('   真正原因是没配 CLI 路径，不是「出码失败」：设置 WECHAT_DEVTOOLS_CLI 指向开发者工具 cli，或把 cli 加进 PATH');
  }
  return lines.join('\n');
}

/** git 短 sha，用于 meta 说明与上传描述；非 git 环境降级 */
function gitShortSha() {
  try {
    return run('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).trim();
  } catch {
    return 'unknown';
  }
}

/** 本地时间格式化：2026-10-11 23:58:01（不依赖 toLocaleString，避免执行机 locale 差异） */
function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * cli preview 参数。--qr-output 必须是项目内的绝对路径（如 .ci-output/cli-preview-qr.png）；
 * 写 /tmp/xxx.png 会报「二维码输出路径无效或不存在 (code 17)」。
 */
function cliPreviewArgs(appRoot, outPath) {
  return ['preview', '--project', appRoot, '--qr-format', 'image', '--qr-output', outPath];
}

/** cli upload 参数 */
function cliUploadArgs(appRoot, version, desc) {
  return ['upload', '--project', appRoot, '-v', version, '-d', desc];
}

/**
 * 归一化用户自定义上传描述：微信「开发版本描述」是单行字段，
 * 换行 / 制表符会被后台吞掉或让 cli 报错，故一律压成单空格并去首尾空白。
 * 纯空白等价于「没传」。
 */
function sanitizeDesc(raw) {
  if (raw == null) return '';
  return String(raw)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 拼 cli upload 的 `-d` 描述。**纯函数**：不打印、不读环境、不跑 git，
 * 版本与 sha 由调用方传入（便于单测注入）。
 *
 * - 未传自定义描述（customDesc 为 null/undefined/纯空白）→ 保持历史格式，逐字符不变：
 *     `cli 上传 v<version> @ <sha>`
 *   —— 这是向后兼容的硬要求，别改这行字面量。
 * - 传了 → `<自定义文本> | v<version> @ <sha>`，版本与 sha 一律保留（后台审计需要）。
 *
 * 总长超过 DESC_MAX_LEN 时只截断自定义文本（base 不动），末尾补 `…` 标记，
 * 并把 truncated 置 true 交由调用方打印提示。按 Unicode 码点截断，不会切坏代理对。
 *
 * @returns {{desc: string, text: string, base: string, truncated: boolean}}
 */
function buildUploadDesc(version, gitSha, customDesc) {
  // tail = 版本 + sha，自定义文案与默认文案共用（后台审计必须能追到版本与 commit）
  const tail = `v${version} @ ${gitSha}`;
  // base = 缺省文案。🔒 这行字面量是向后兼容基准，不得改动（历史 desc 逐字符一致）
  const base = `cli 上传 ${tail}`;
  const text = sanitizeDesc(customDesc);
  if (!text) return { desc: base, text: '', base, truncated: false };

  const SEP = ' | ';
  const budget = DESC_MAX_LEN - tail.length - SEP.length;
  // tail 自身已占满上限（版本号/sha 异常长）→ 退回默认描述，不产出超长或空文本
  if (budget < 2) return { desc: base, text, base, truncated: true };

  const chars = Array.from(text);
  if (chars.length <= budget) return { desc: `${text}${SEP}${tail}`, text, base, truncated: false };

  const kept = chars.slice(0, budget - 1).join('').trim() + '…';
  return { desc: `${kept}${SEP}${tail}`, text: kept, base, truncated: true };
}

/**
 * 拼 cli 出码的 meta（cli 不生成 meta.json，需脚本自拼，供 push 说明文案使用）。
 * 版本取 package.json.version、git sha 取 git rev-parse --short HEAD、有效期按 25 分钟口径。
 * opts 可注入 version/gitSha/ttlMinutes/now，便于单测与复用。
 */
function buildCliMeta(pagePath, opts = {}) {
  const pkg = require(path.join(ROOT, 'package.json'));
  const version = opts.version || pkg.version || '1.0.0';
  const gitSha = opts.gitSha || gitShortSha();
  const ttlMinutes = Number(opts.ttlMinutes || PREVIEW_TTL_MIN);
  const createdAtMs = Number(opts.now != null ? opts.now : Date.now());
  const createdAt = new Date(createdAtMs);
  const expireAtMs = createdAtMs + ttlMinutes * 60 * 1000;
  const expireAt = new Date(expireAtMs);
  return {
    version,
    gitSha,
    pagePath,
    createdAt: createdAt.toISOString(),
    createdAtText: fmt(createdAt),
    expireAt: expireAt.toISOString(),
    expireAtText: fmt(expireAt),
    expireAtMs,
    ttlMinutes,
    hint: '预览码过期后必须重新生成；需要长期可用的码请走 upload 上传开发版本，再人工在公众平台「设为体验版」（体验版连 prod、体验成员可扫、体验版二维码官方口径 7 天）',
  };
}

/** 把 cli 出的 meta 写到 png 旁边（文件名与 png 同名，供 pushQr 读取） */
function writeCliMeta(outPath, meta) {
  const dest = path.join(
    path.dirname(outPath),
    path.basename(outPath, path.extname(outPath)) + '.meta.json',
  );
  fs.writeFileSync(dest, JSON.stringify(meta, null, 2) + '\n');
  return dest;
}

// ---------- 子命令 ----------

/**
 * 出码前硬门禁（preview / upload 入口第一件事）。
 *
 * 🔴 为什么放在 main() 的子命令分支最前面，而不是 cmdPreview / cmdUpload 内部：
 *    1. 位置等价于「子命令第一步」，且**先于任何 CLI 调用**（两条路的第一个动作就是它）；
 *    2. cmdPreview / cmdUpload 被单测直接调用时保持纯函数语义 —— publish.test.ts 是
 *       「向后兼容基准」（文件里明确写着「不得为了让测试变绿而改它」），
 *       把 spawn git 的门禁塞进 cmdUpload 会污染它「execFileSync 零调用」的断言。
 *
 * 🔴 失败就 exit 1，不给「继续出码」的口子；唯一例外是显式 --skip-preflight（打印风险自负）。
 *
 * mode 会透传进 preflight：cli 模式要求「包根无私钥 + 开发者工具 CLI 可执行」；
 * ci 模式（miniprogram-ci）则相反 —— 私钥是必需文件，改由 packOptions.ignore 兜底。
 */
function preflightGate(opts, sub) {
  if (opts.skipPreflight) {
    console.warn('[Preflight] ⚠️ 已跳过出码前检查，风险自负（--skip-preflight）');
    return;
  }
  const result = preflight.runPreflight({
    mode: resolveMode(opts.mode),
    expectSha: opts.expectSha,
    requireDir: opts.requireDir,
    allowDirty: opts.allowDirty,
    forUpload: sub === 'upload',
  });
  preflight.printReport(result);
  if (!result.ok) process.exit(1);
}

function cmdPreview(opts) {
  const mode = resolveMode(opts.mode);
  if (mode === 'ci') {
    if (opts.page) process.env.PREVIEW_PAGE = opts.page;
    console.log('[Publish] 出预览码（miniprogram-ci 模式）…');
    try {
      run('node', ['scripts/preview.js'], { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
      console.error('[Publish] ❌ 出码失败。最常见原因：本机出口 IP 不在公众平台 IP 白名单');
      console.error('[Publish]    处置：把报错里的 IP 加进 公众平台 → 开发管理 → 开发设置 → IP 白名单');
      console.error('[Publish]    或改用默认 cli 模式（免白名单）：去掉 --mode ci');
      process.exit(1);
    }
    if (opts.noPush) {
      console.log('[Publish] 已出码（--no-push，跳过推送）');
      return;
    }
    pushQr(path.join(CI_OUT, 'preview-qr.png'), opts.to);
    return;
  }

  // cli 模式（默认，免白名单）
  if (opts.page) {
    console.log('[Publish] ⚠️ cli 模式出的是默认入口页二维码，--page 仅对 --mode ci 生效，此处忽略');
  }
  console.log('[Publish] 出预览码（cli 模式，免 IP 白名单）…');
  const cli = resolveCliBinary();
  const outPath = path.join(CI_OUT, 'cli-preview-qr.png');
  try {
    fs.mkdirSync(CI_OUT, { recursive: true });
    run(cli, cliPreviewArgs(ROOT, outPath), { stdio: 'inherit' });
  } catch (e) {
    console.error('[Publish] ❌ cli 出码失败。排查：');
    console.error('[Publish]   1. 微信开发者工具已登录（cli islogin → {"login":true}）');
    console.error('[Publish]   2. --qr-output 必须是项目内路径（本脚本已写 .ci-output/cli-preview-qr.png，勿改 /tmp）');
    console.error('[Publish]   3. 设置 WECHAT_DEVTOOLS_CLI 指向 cli 二进制，或确保 cli 在 PATH 中（which cli）');
    console.error(describeCliError(e));
    process.exit(1);
  }
  // cli 不产 meta.json，脚本自拼 meta 供 push 说明文案使用
  const meta = buildCliMeta(DEFAULT_PAGE);
  writeCliMeta(outPath, meta);
  if (opts.noPush) {
    console.log('[Publish] 已出码（--no-push，跳过推送）');
    return;
  }
  pushQr(outPath, opts.to);
}

function cmdUpload(opts) {
  const mode = resolveMode(opts.mode);
  const pkg = require(path.join(ROOT, 'package.json'));
  const version = pkg.version || '1.0.0';
  // 上传前先锁死「包版本 = 关于页显示版本」，不一致直接 exit 1（preview 不走这里）
  assertVersionConsistent(version);
  if (mode === 'ci') {
    // ci 模式走 scripts/upload.js，描述由它自行生成（上传时间口径）；
    // 用户传了 --desc 就明说被忽略，不做静默丢弃。
    if (sanitizeDesc(opts.desc)) {
      console.log('[Publish] ⚠️ --desc 仅对 cli 模式生效；--mode ci 的描述由 scripts/upload.js 生成，本次忽略');
    }
    console.log('[Publish] 上传开发版本（miniprogram-ci 模式）…');
    try {
      run('node', ['scripts/upload.js'], { cwd: ROOT, stdio: 'inherit' });
    } catch (e) {
      console.error('[Publish] ❌ 上传失败');
      process.exit(1);
    }
  } else {
    console.log('[Publish] 上传开发版本（cli 模式，免 IP 白名单）…');
    const cli = resolveCliBinary();
    // 不传 --desc 时 desc 与历史完全一致：`cli 上传 v<version> @ <sha>`
    const descInfo = buildUploadDesc(version, gitShortSha(), opts.desc);
    if (descInfo.truncated) {
      console.log(`[Publish] ⚠️ --desc 超长，已截断到 ${DESC_MAX_LEN} 字符（保留版本与 sha）：${descInfo.desc}`);
    }
    try {
      run(cli, cliUploadArgs(ROOT, version, descInfo.desc), { stdio: 'inherit' });
    } catch (e) {
      console.error(`[Publish] ❌ cli 上传失败。排查：微信开发者工具已登录、版本号已递增（当前 v${version}）。`);
      console.error(describeCliError(e));
      process.exit(1);
    }
  }
  // 无论是否 --notify，上传成功后都打印「开发版本已上传 → 后续人工步骤」指引（§3.4 原文）。
  // 脚本到此为止：设为体验版 / 提交审核 / 发布均为公众平台人工操作，脚本不代做。
  console.log(GUIDE_UPLOAD_CONSOLE(version));
  if (opts.notify) {
    const target = resolveTarget(opts.to);
    sendMarkdown(target.chat_id, NOTIFY_UPLOAD(version));
    console.log('[Publish] ✅ 已上传并推送通知');
  }
}

/**
 * trial / release：纯打印人工分步指引，零副作用。
 * 🔴 只读 package.json.version 并打印；不调用微信 CLI、不调任何 HTTP/微信 API、
 *    不写文件、不推企业微信、不改版本状态。本次不实现 --notify。
 * 微信不向自建小程序开放「设为体验版 / 提交审核 / 发布」接口，故不存在「自动发布」路径。
 */
function readVersion() {
  const pkg = require(path.join(ROOT, 'package.json'));
  return pkg.version || '1.0.0';
}

/**
 * 读 utils/version.ts 里的 APP_VERSION 字面量（上传前的漂移校验用）。
 *
 * 🔴 用正则读源码而不是 require：`.ts` 文件 Node 直接 require 不了。
 *    返回 '' 表示没找到 —— 由调用方当成「不一致」处理（宁可不传，也不传一个界面会显示错的包）。
 */
function readAppVersionConst() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'utils', 'version.ts'), 'utf-8');
    const m = src.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/**
 * 上传前硬校验：关于页展示的版本号必须与包版本号一致。
 *
 * 1.0.17 的「包是 1.0.17、界面显示 v1.0.0」就是这么漏出去的 —— 两处版本没有任何联动。
 * 不一致直接 exit 1：宁可上传失败，也不要把一个界面版本号错位的包发给用户。
 * 只挂在 upload 上（preview 不受影响，出预览码不需要版本号吻合）。
 */
function assertVersionConsistent(version) {
  const declared = readAppVersionConst();
  if (declared !== version) {
    console.error(
      `[Publish] ❌ 版本号不一致：package.json=${version}，utils/version.ts=${declared || '(未找到 APP_VERSION)'}`,
    );
    console.error('[Publish]    后果：关于页显示的版本号会与包版本号不符（1.0.17 的 v1.0.0 事故）');
    console.error('[Publish]    处置：把 utils/version.ts 的 APP_VERSION 改成与 package.json.version 一致后重试');
    process.exit(1);
  }
}

function cmdTrial() {
  console.log(GUIDE_TRIAL(readVersion()));
}

function cmdRelease() {
  console.log(GUIDE_RELEASE(readVersion()));
}

function cmdPush(opts) {
  pushQr(opts._[0] || path.join(CI_OUT, 'preview-qr.png'), opts.to);
}

// ---------- 入口 ----------

function main(argv) {
  const sub = argv[0];
  const opts = parseArgs(argv.slice(1));

  switch (sub) {
    case 'preview':
      // 出码前硬门禁：站错目录 / 带私钥 / 版本不对，一律跑不起来（--skip-preflight 可显式跳过）
      preflightGate(opts, 'preview');
      cmdPreview(opts);
      break;
    case 'upload':
      // 同上；--skip-preflight 时打印「风险自负」后照旧走原逻辑
      preflightGate(opts, 'upload');
      cmdUpload(opts);
      break;
    case 'push':
      cmdPush(opts);
      break;
    case 'trial':
      cmdTrial();
      break;
    case 'release':
      cmdRelease();
      break;
    default:
      console.log([
        '用法:',
        '  node scripts/publish.js preview [--page <page>] [--to <会话名>] [--no-push] [--mode cli|ci]',
        '  node scripts/publish.js upload [--desc <文本>] [--notify] [--to <会话名>] [--mode cli|ci]',
        '  node scripts/publish.js push <二维码png> [--to <会话名>]',
        '  node scripts/publish.js trial                 打印「设为体验版」人工分步指引（零副作用）',
        '  node scripts/publish.js release               打印「提交审核 → 发布正式版」人工分步指引（零副作用）',
        '',
        '  --mode cli  默认。微信开发者工具 CLI 出码，免 IP 白名单（需已登录）。',
        '  --mode ci   miniprogram-ci 出码，需固定出口 IP 白名单（执行机场景）。',
        '',
        '  --desc <文本>  upload 专用。自定义开发版本描述（后台备注），可写 `--desc=文本`。',
        '                不传则用默认格式「cli 上传 v<版本> @ <sha>」；',
        '                传了则「<文本> | v<版本> @ <sha>」，版本与 sha 一律保留便于审计。',
        '',
        '  --skip-preflight  preview / upload 跳过出码前检查（打印「风险自负」，仅限已知异常场景）。',
        '  --expect-sha <sha> 声明期望 HEAD sha，preflight 核对，不符即阻断；可用逗号给多个候选（019d282b,47f74ba8）。',
        '  --require-dir <正则> 把「目录白名单」从警告升级为硬拦，发布轮次建议 ^web_system-1018(-r2)?$。',
        '  --allow-dirty     放行「会进包的未提交改动」（默认阻断，打印警告）。',
        '',
        '  边界：本脚本只到「上传开发版本」为止；设为体验版 / 提交审核 / 发布须在微信公众平台人工操作，',
        '        微信不向自建小程序开放对应接口，脚本不代做、也不会自称已推进。',
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
  resolveMode,
  resolveTarget,
  resolveCliBinary,
  describeCliError,
  gitShortSha,
  fmt,
  cliPreviewArgs,
  cliUploadArgs,
  sanitizeDesc,
  buildUploadDesc,
  DESC_MAX_LEN,
  buildCliMeta,
  writeCliMeta,
  readAppVersionConst,
  assertVersionConsistent,
  pushQr,
  uploadMedia,
  sendMarkdown,
  sendImage,
  cmdPreview,
  cmdUpload,
  cmdTrial,
  cmdRelease,
  cmdPush,
  main,
  NOTIFY_UPLOAD,
  GUIDE_TRIAL,
  GUIDE_RELEASE,
  GUIDE_UPLOAD_CONSOLE,
};
