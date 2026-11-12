/**
 * 微信小程序「开发版出码 + 企业微信推送」一键脚本
 * 使用方法:
 *   MINIPROGRAM_CI_PATH=~/mp-ci/node_modules node scripts/preview-push.js
 *
 * 解决什么问题:
 *   每次出开发版二维码后要人工处理两件重复劳动:
 *     ① 本机出口默认走 IPv6（240e:...），公众平台白名单只加了 IPv4 时上传报
 *        errCode:-10008 invalid ip —— 需要强制 IPv4；
 *     ② 把二维码图片手动发到企业微信（现查会话、上传媒体、发消息）。
 *        注意 wecom-cli media upload 有路径白名单（~/AiWorkspace、/private/tmp），
 *        脚本会先把二维码复制到 /private/tmp 下的临时目录再上传。
 *   本脚本把这两步固化成一条免确认命令。
 *
 * 与 preview.js 的关系:
 *   不重写出码逻辑。通过 spawn 子进程调 scripts/preview.js（注入 IPv4/清代理环境），
 *   出码成功后读 .ci-output/preview-qr.meta.json 拿版本/gitSha/有效期做企微推送。
 *   preview.js 既有行为零改动。
 *
 * 可选环境变量（除 preview.js 支持的全部变量外）:
 *   WECOM_PUSH=0      只出码，不做企微推送（预检也会跳过 wecom-cli 授权检查）
 *   FORCE_IPV4=0      不强制 IPv4（默认通过 NODE_OPTIONS=--dns-result-order=ipv4first 强制 v4）
 *   WECOM_CHAT_NAME   目标单聊名称，默认「文追」（每次运行时现查 sessions，不缓存 chat_id）
 *
 * 降级原则:
 *   企微推送失败（未授权/找不到会话/上传或发送失败）不影响出码产物，
 *   脚本降级为「只出本地卡片」，末尾总结如实报告推送失败原因，退出码仍为 0。
 *   只有预检失败或出码失败才 exit 1。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PREVIEW_SCRIPT = path.join(__dirname, 'preview.js');
const WECOM_PUSH = process.env.WECOM_PUSH !== '0';
const FORCE_IPV4 = process.env.FORCE_IPV4 !== '0';
const WECOM_CHAT_NAME = process.env.WECOM_CHAT_NAME || '文追';

/** 清代理时要剔除的环境变量（本机 shell 常挂 127.0.0.1 代理，会让 miniprogram-ci 请求走代理而失败） */
const PROXY_VARS = ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'];

function fail(title, lines) {
  console.error(`[PreviewPush] ❌ ${title}`);
  lines.forEach((l) => console.error(`[PreviewPush]    ${l}`));
  process.exit(1);
}

/* ---------------- 1. 预检 ---------------- */

function preflight() {
  console.log('[PreviewPush] ── 预检 ──');

  // 1.1 private.key
  const keyPath = path.join(ROOT, 'private.key');
  if (!fs.existsSync(keyPath)) {
    fail('缺少私钥 private.key', [
      '请从公众平台下载「小程序代码上传密钥」，保存为 apps/dachengzi-minigram/private.key',
      '路径: mp.weixin.qq.com → 开发管理 → 开发设置 → 小程序代码上传',
    ]);
  }
  console.log('[PreviewPush] ✅ private.key 存在');

  // 1.2 miniprogram-ci 可加载（与 preview.js 同一套隔离安装约定）
  const ciRoot = process.env.MINIPROGRAM_CI_PATH;
  try {
    require.resolve(ciRoot ? path.join(ciRoot, 'miniprogram-ci') : 'miniprogram-ci');
  } catch {
    fail('miniprogram-ci 不可加载', [
      '本仓库是 pnpm monorepo，提升的 @babel/helper-compilation-targets 与 miniprogram-ci 编译链不兼容，需隔离安装:',
      '  mkdir -p ~/mp-ci && cd ~/mp-ci && npm i miniprogram-ci@2.1.31',
      '然后带环境变量运行:',
      '  MINIPROGRAM_CI_PATH=~/mp-ci/node_modules node scripts/preview-push.js',
    ]);
  }
  console.log(`[PreviewPush] ✅ miniprogram-ci 可加载（${ciRoot || '仓库 node_modules'}）`);

  // 1.3 wecom-cli 已授权（仅推送开启时检查）
  if (WECOM_PUSH) {
    let status;
    try {
      status = execFileSync('wecom-cli', ['auth', 'show', '--status'], {
        encoding: 'utf8',
        timeout: 30000,
      }).trim();
    } catch (e) {
      if (e.code === 'ENOENT') {
        fail('wecom-cli 未安装', ['安装: npm install -g @wecom/cli', '装完重跑本命令']);
      }
      fail('wecom-cli auth show --status 执行失败', [String(e.message).slice(0, 300)]);
    }
    if (!/^authorized$/m.test(status)) {
      fail('wecom-cli 未授权', [
        `当前状态: ${status || '(空输出)'}`,
        '授权: wecom-cli auth init --noninteractive（扫码后重跑本命令）',
        '如暂时不想推送，可用 WECOM_PUSH=0 只出码',
      ]);
    }
    console.log('[PreviewPush] ✅ wecom-cli 已授权');
  } else {
    console.log('[PreviewPush] ⏭️  WECOM_PUSH=0，跳过 wecom-cli 授权检查');
  }
}

/* ---------------- 2. 出码（spawn preview.js，注入 IPv4 + 清代理环境） ---------------- */

function runPreview() {
  console.log('');
  console.log('[PreviewPush] ── 出码（复用 scripts/preview.js） ──');
  const env = { ...process.env };
  PROXY_VARS.forEach((k) => delete env[k]);
  if (FORCE_IPV4) {
    // 本机出口默认 IPv6，公众平台白名单只认已加的 IPv4。
    // --dns-result-order=ipv4first 让 dns.lookup 优先返回 v4 地址，miniprogram-ci 内部请求随之走 v4。
    env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --dns-result-order=ipv4first`.trim();
    console.log('[PreviewPush] 已强制 IPv4（NODE_OPTIONS=--dns-result-order=ipv4first），FORCE_IPV4=0 可关闭');
  } else {
    console.log('[PreviewPush] FORCE_IPV4=0，未强制 IPv4（若报 invalid ip 请检查出口 IP 版本）');
  }
  const cleared = PROXY_VARS.filter((k) => process.env[k]);
  console.log('[PreviewPush] 已清除代理环境变量: ' + (cleared.join(', ') || '(本进程无代理变量)'));

  const r = spawnSync(process.execPath, [PREVIEW_SCRIPT], { cwd: ROOT, env, stdio: 'inherit' });
  if (r.error) fail('preview.js 启动失败', [String(r.error.message)]);
  if (r.status !== 0) {
    fail('出码失败（preview.js 退出码 ' + r.status + '）', [
      '上方 [Preview] 日志已给出排查指引；最常见原因是本机公网 IP 不在公众平台白名单',
      '查本机出口 IP: curl -s ifconfig.me（注意若为 IPv6 地址，确认本脚本未开 FORCE_IPV4=0）',
      '白名单路径: mp.weixin.qq.com → 开发管理 → 开发设置 → IP 白名单',
    ]);
  }
}

/* ---------------- 3. 读出码元信息 ---------------- */

function readMeta() {
  const qrDest = path.resolve(ROOT, process.env.QRCODE_DEST || '.ci-output/preview-qr.png');
  const metaPath = path.join(path.dirname(qrDest), 'preview-qr.meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return { meta, qrPng: qrDest };
  } catch (e) {
    console.warn(`[PreviewPush] ⚠️ 读取 ${metaPath} 失败（${e.message}），推送文案将缺少版本信息`);
    return { meta: {}, qrPng: qrDest };
  }
}

/* ---------------- 4. 企微推送 ---------------- */

/** 调 wecom-cli 并解析 JSON 输出；失败抛出带原因的错误（由上层降级处理） */
function wecom(args, timeoutMs) {
  let out;
  try {
    out = execFileSync('wecom-cli', args, { encoding: 'utf8', timeout: timeoutMs || 60000 });
  } catch (e) {
    const detail = (e.stderr || e.stdout || e.message || String(e)).trim();
    throw new Error(`wecom-cli ${args.slice(0, 3).join(' ')} 失败: ${detail.slice(0, 300)}`);
  }
  try {
    return JSON.parse(out);
  } catch {
    // 兜底：输出里可能带非 JSON 前缀/后缀，截取第一个 { 到最后一个 }
    const s = out.indexOf('{');
    const t = out.lastIndexOf('}');
    if (s >= 0 && t > s) return JSON.parse(out.slice(s, t + 1));
    throw new Error('wecom-cli 输出不是 JSON: ' + out.slice(0, 200));
  }
}

/** 现查「文追」单聊 chat_id（每次运行现查，不缓存） */
function findChatId() {
  const data = wecom(['message', 'aibot', 'sessions', 'list'], 30000);
  const sessions = data.sessions || [];
  const hits = sessions.filter((s) => s.chat_name === WECOM_CHAT_NAME && s.chat_type === 'single');
  if (hits.length === 0) {
    const names = sessions.map((s) => `${s.chat_name || '(无名)'}[${s.chat_type}]`).join('、') || '(无会话)';
    throw new Error(`最近会话中找不到「${WECOM_CHAT_NAME}」单聊（当前会话: ${names}）。请先在企微里给机器人发一条消息激活会话`);
  }
  if (hits.length > 1) {
    console.warn(`[PreviewPush] ⚠️ 命中 ${hits.length} 个「${WECOM_CHAT_NAME}」单聊，取最近一个（${hits[0].last_msg_time}）`);
  }
  return hits[0].chat_id;
}

/**
 * 把二维码复制到 wecom-cli 可访问的目录后再上传。
 * 实测 wecom-cli media upload 有路径白名单（仅 ~/AiWorkspace 与 /private/tmp），
 * 直接传仓库下的 .ci-output/preview-qr.png 会报 PermissionError(893006)「目标路径超出可访问范围」。
 */
function stageQrForUpload(qrPng) {
  const base = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'mp-preview-qr-'));
  const staged = path.join(dir, 'preview-qr.png');
  fs.copyFileSync(qrPng, staged);
  return staged;
}

/** 发送媒体消息: 优先 image（聊天内可直接看），失败降级 file（仍可达，需点开） */
function sendMedia(chatId, mediaId) {
  try {
    const r = wecom(
      ['message', 'aibot', 'send', '--json', JSON.stringify({ chat_id: chatId, msg_type: 'image', image: { media_id: mediaId } })],
      60000
    );
    if (r.error || r.errcode) throw new Error(JSON.stringify(r).slice(0, 200));
    return 'image';
  } catch (e) {
    console.warn(`[PreviewPush] ⚠️ 图片消息发送失败（${e.message}），降级为文件消息重试`);
    const r = wecom(
      ['message', 'aibot', 'send', '--json', JSON.stringify({ chat_id: chatId, msg_type: 'file', file: { media_id: mediaId } })],
      60000
    );
    if (r.error || r.errcode) throw new Error('文件消息也发送失败: ' + JSON.stringify(r).slice(0, 200));
    return 'file';
  }
}

function pushToWecom(meta, qrPng) {
  if (!fs.existsSync(qrPng)) {
    throw new Error(`二维码文件不存在: ${qrPng}（QRCODE_FORMAT 非 image 时不产出图片，无法推送）`);
  }

  // 顺序遵循 wecomcli 技能约束: 先锁定目标会话，再上传媒体，最后发送
  const chatId = findChatId();
  console.log(`[PreviewPush] ✅ 命中目标会话「${WECOM_CHAT_NAME}」单聊`);

  const staged = stageQrForUpload(qrPng);
  try {
    const up = wecom(['media', 'upload', '--json', JSON.stringify({ file_path: staged })], 120000);
    if (!up.media_id) throw new Error('media upload 未返回 media_id: ' + JSON.stringify(up).slice(0, 200));
    console.log('[PreviewPush] ✅ 二维码已上传为企微媒体');

    const sentAs = sendMedia(chatId, up.media_id);
    console.log(`[PreviewPush] ✅ ${sentAs === 'image' ? '图片' : '文件'}消息已发送`);
  } finally {
    // 临时目录清理（media_id 已生成，不依赖本地副本）
    try {
      fs.rmSync(path.dirname(staged), { recursive: true, force: true });
    } catch { /* 忽略清理失败 */ }
  }

  const expireHHMM = (meta.expireAtText || '').slice(11, 16) || '(未知)';
  const content = [
    '**大橙子开发版预览码**',
    `> 版本: v${meta.version || '?'} · ${meta.gitSha || '?'}`,
    `> ⏳ 有效期至 **${expireHHMM}**（${meta.ttlMinutes || 25} 分钟，过期需重跑）`,
    `> 直达页: ${meta.pagePath || 'pages/home/index/index'}`,
    '> 扫码不出来先看是否已过期；真机需开「开发调试」',
  ].join('\n');
  const sendText = wecom(
    ['message', 'aibot', 'send', '--json', JSON.stringify({ chat_id: chatId, msg_type: 'markdown', markdown: { content } })],
    60000
  );
  if (sendText.error || sendText.errcode) {
    throw new Error('发送文本消息失败: ' + JSON.stringify(sendText).slice(0, 200));
  }
  console.log('[PreviewPush] ✅ 说明文本已发送');
}

/* ---------------- 主流程 ---------------- */

function main() {
  preflight();
  runPreview();

  const { meta, qrPng } = readMeta();
  let pushResult = '未执行（WECOM_PUSH=0）';
  if (WECOM_PUSH) {
    console.log('');
    console.log('[PreviewPush] ── 企微推送 ──');
    try {
      pushToWecom(meta, qrPng);
      pushResult = `成功（已发图片 + 文本到「${WECOM_CHAT_NAME}」单聊）`;
    } catch (e) {
      // 降级: 推送失败不影响出码产物
      pushResult = `失败（已降级为只出本地卡片）: ${e.message}`;
      console.warn(`[PreviewPush] ⚠️ 企微推送失败: ${e.message}`);
      console.warn('[PreviewPush] ⚠️ 出码产物不受影响，请打开本地卡片扫码（路径见下方总结）');
    }
  }

  console.log('');
  console.log('[PreviewPush] ══ 总结 ══');
  console.log(`[PreviewPush] 版本:     v${meta.version || '?'}（gitSha ${meta.gitSha || '?'}）`);
  console.log(`[PreviewPush] 有效期:   ${meta.createdAtText || '?'} ~ ${meta.expireAtText || '?'}（${meta.ttlMinutes || 25} 分钟）`);
  console.log(`[PreviewPush] 直达页:   ${meta.pagePath || 'pages/home/index/index'}`);
  console.log(`[PreviewPush] 产物:     ${qrPng}`);
  console.log(`[PreviewPush] 本地卡片: ${path.join(path.dirname(qrPng), 'preview-qr.html')}`);
  console.log(`[PreviewPush] 企微推送: ${pushResult}`);
}

main();
