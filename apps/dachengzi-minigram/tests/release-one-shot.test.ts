/// <reference types="node" />
/**
 * 唯一发布入口脚本 scripts/release-one-shot.sh 测试
 *
 * 🔴 这个测试在验什么（对应本轮发布实证的四条失效）：
 *   ① S2 目录硬检真的会拦：把脚本放进一个名字带 `web_system-dachengzi` 的临时目录，
 *      不给 --force-dir，必须非 0 退出、提示里出现 `web_system-dachengzi`、且**走不到 S4**
 *      （publish 桩没被调用）。只在断言文字里说「会拦」不算数。
 *   ② --force-dir 是「有理由的放行」而不是「静默放行」：理由必须原样出现在人读输出里，
 *      并落进 S6 机读结论的 forcedDir 字段。
 *   ③ WECHAT_DEVTOOLS_CLI 回落：环境变量为空时回落到官方安装路径（并做 -x 检查）；
 *      指向不存在文件时直接拒跑，而不是等 spawn 报 ENOENT 再让人猜。
 *   ④ S6 那一行必须能被 JSON.parse：连同 sha256 一起给出**实测**摘要，
 *      sha256 与 `shasum -a 256` 逐字符一致（不是从文件名/时间猜出来的）。
 *
 * 隔离手段：
 *   · 不跑真实出码/上传。临时目录里放 scripts/preflight.js 与 scripts/publish.js 两个桩，
 *     publish 桩只写假的 png + meta.json，命令行参数原样落到 .ci-output/args.json 供断言。
 *   · 临时目录 git init 一次，让 gitSha 走真实的 `git rev-parse --short=8` 分支。
 *   · 只读被测脚本原文（复制到临时目录），不改仓库里的任何文件。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync, execFileSync } from 'child_process';

const SCRIPT_SRC = path.join(__dirname, '..', 'scripts', 'release-one-shot.sh');

/** preflight 桩：无条件通过，并留一行输出证明 S1 确实执行过 */
const STUB_PREFLIGHT = `#!/usr/bin/env node
'use strict';
process.stdout.write('[Preflight] stub: 四项检查通过（测试桩，不做真实检查）\\n');
process.stdout.write('[Preflight] stub argv=' + JSON.stringify(process.argv.slice(2)) + '\\n');
process.exit(0);
`;

/**
 * publish 桩：模拟成功路径，产出 cli-preview-qr.png + cli-preview-qr.meta.json。
 * 真实 publish.js 的产物形态照抄（meta 字段含 expireAtText / expireAtMs / version），
 * 但字节内容是假的 —— 单测里不需要真的二维码，只需要「摘要确实是现算的」。
 */
const STUB_PUBLISH = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const out = path.join(process.cwd(), '.ci-output');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'args.json'), JSON.stringify(args, null, 2));
if (args[0] === 'preview') {
  const now = Date.now();
  const png = path.join(out, 'cli-preview-qr.png');
  fs.writeFileSync(png, Buffer.from('STUB-PNG-BYTES-' + now + '\\n'));
  fs.writeFileSync(
    path.join(out, 'cli-preview-qr.meta.json'),
    JSON.stringify({
      version: process.env.STUB_VERSION || '1.0.18',
      gitSha: 'stub',
      pagePath: 'pages/index/index',
      createdAt: new Date(now).toISOString(),
      expireAt: new Date(now + 25 * 60000).toISOString(),
      expireAtText: '2026-11-26 16:00:00',
      expireAtMs: now + 25 * 60000,
      ttlMinutes: 25
    }, null, 2) + '\\n'
  );
}
process.stdout.write('[Publish] stub ' + args[0] + ' ok\\n');
`;

interface Fixture {
  root: string;
  appRoot: string;
  script: string;
  cleanup: () => void;
}

/**
 * 造一个临时 worktree 形状：
 *   <root>/apps/dachengzi-minigram/scripts/{release-one-shot.sh, preflight.js, publish.js}
 * root 的目录名带上前缀，用来测 S2 的目录硬检。
 */
function makeFixture(prefix: string): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const appRoot = path.join(root, 'apps', 'dachengzi-minigram');
  const scriptsDir = path.join(appRoot, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const script = path.join(scriptsDir, 'release-one-shot.sh');
  fs.copyFileSync(SCRIPT_SRC, script);
  fs.chmodSync(script, 0o755);

  fs.writeFileSync(path.join(scriptsDir, 'preflight.js'), STUB_PREFLIGHT);
  fs.writeFileSync(path.join(scriptsDir, 'publish.js'), STUB_PUBLISH);

  // 让 gitSha 走真实分支：空提交即可，git 只关心有没有 HEAD。
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit',
    '-q', '--allow-empty', '-m', 'fixture'], { cwd: root });

  return {
    root,
    appRoot,
    script,
    cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  combined: string;
  lines: string[];
}

/** 用 bash 显式执行（被测脚本声明 bash，不该被调用方的 zsh 影响）。 */
function runScript(
  fx: Fixture,
  args: string[],
  extraEnv: Record<string, string | undefined> = {},
  cwd = os.tmpdir(),
): RunResult {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.WECHAT_DEVTOOLS_CLI;
  delete env.WECHAT_DEVTOOLS_CLI_DEFAULT;
  delete env.STUB_VERSION;
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  // spawnSync 的 env 不允许 undefined 值
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];

  const r = spawnSync('bash', [fx.script, ...args], {
    cwd,                       // 故意给一个无关目录，验证 S0 不受外部 cwd 影响
    env: env as NodeJS.ProcessEnv,
    encoding: 'utf8',
  });
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  return {
    status: r.status === null ? -1 : r.status,
    stdout,
    stderr,
    combined: stdout + stderr,
    lines: (stdout + stderr).split('\n'),
  };
}

/** 取最后一条非空行（S6 结论恒为最后一条）。 */
function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

const fixtures: Fixture[] = [];
function track(fx: Fixture): Fixture { fixtures.push(fx); return fx; }

afterAll(() => {
  for (const fx of fixtures) {
    try { fx.cleanup(); } catch { /* 临时目录清理失败不影响结果 */ }
  }
});

describe('release-one-shot.sh · S0 目录锚定', () => {
  it('无视调用方 cwd，PWD 恒为脚本自身所在 app 目录', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18'], {}, os.tmpdir());

    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`[S0] PWD=${fx.appRoot}`);
    // 从 os.tmpdir() 启动也没关系 —— 外部 cwd 影响不了 S0
    expect(r.stdout).not.toContain(`[S0] PWD=${os.tmpdir()}\n`);
  });

  it('缺少 --mode / --version 时拒跑（不给默认值蒙混）', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const noMode = runScript(fx, ['--version', '1.0.18']);
    expect(noMode.status).not.toBe(0);
    expect(noMode.combined).toContain('缺少 --mode');

    const noVersion = runScript(fx, ['--mode', 'preview']);
    expect(noVersion.status).not.toBe(0);
    expect(noVersion.combined).toContain('缺少 --version');

    // 非法 mode 也不放过
    const badMode = runScript(fx, ['--mode', 'publish', '--version', '1.0.18']);
    expect(badMode.status).not.toBe(0);
    expect(badMode.combined).toContain('仅支持 preview|upload');
  });
});

describe('release-one-shot.sh · S2 目录硬检', () => {
  it('路径不含 web_system-1018 → 非 0 退出、点名 web_system-dachengzi、且不进入 S4', () => {
    const fx = track(makeFixture('web_system-dachengzi-oneshot-'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18']);

    expect(r.status).not.toBe(0);
    expect(r.combined).toContain('目录硬检未通过');
    // 必须点名那个真实的危险目录，否则人看不懂为什么被拦
    expect(r.combined).toContain('web_system-dachengzi');
    expect(r.combined).toContain('private.key');
    // 被拦在 S4 之前：publish 桩一次都没被调用
    expect(fs.existsSync(path.join(fx.appRoot, '.ci-output', 'args.json'))).toBe(false);
    // 失败也要给机读结论，且明说没锁住证据
    const json = JSON.parse(lastNonEmptyLine(r.stderr));
    expect(json.EVIDENCE_LOCKED).toBe(false);
    expect(String(json.reason)).toContain('S2');
  });

  it('--force-dir 放行但把理由写进人读输出与 S6 forcedDir', () => {
    const fx = track(makeFixture('web_system-dachengzi-oneshot-'));
    const reason = '测试理由：仅单测桩目录';
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18', '--force-dir', reason]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[S2] ⚠️⚠️ 目录硬检已被 --force-dir 跳过');
    expect(r.stdout).toContain(reason);

    const json = JSON.parse(lastNonEmptyLine(r.stdout));
    expect(json.forcedDir).toBe(reason);
    expect(json.EVIDENCE_LOCKED).toBe(true);
  });

  it('--force-dir 的理由太短也拒跑（堵「随便写两个字糊过去」）', () => {
    const fx = track(makeFixture('web_system-dachengzi-oneshot-'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18', '--force-dir', '要']);
    expect(r.status).not.toBe(0);
    expect(r.combined).toContain('理由太短');
  });
});

describe('release-one-shot.sh · S3 CLI 回落', () => {
  it('WECHAT_DEVTOOLS_CLI 为空时回落到 WECHAT_DEVTOOLS_CLI_DEFAULT 且校验可执行', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const stubCli = path.join(fx.root, 'fake-cli');
    fs.writeFileSync(stubCli, '#!/usr/bin/env bash\necho fake-cli\n');
    fs.chmodSync(stubCli, 0o755);

    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18'], {
      WECHAT_DEVTOOLS_CLI: '',
      WECHAT_DEVTOOLS_CLI_DEFAULT: stubCli,
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[S3] WECHAT_DEVTOOLS_CLI 未设置，回落官方安装路径：');
    expect(r.stdout).toContain(stubCli);
    expect(r.stdout).toContain(`[S3] CLI 就绪：${stubCli}`);
  });

  it('回落链末端的官方路径恒被点名（本机没装时也不会默默 ENOENT）', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const canonical = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18'], {
      WECHAT_DEVTOOLS_CLI: '',
      WECHAT_DEVTOOLS_CLI_DEFAULT: undefined,
    });

    // 装了 → 走成功路径；没装 → 走「回落的 CLI 不可执行」，两条路都必须打印这个路径。
    // 这样测试不依赖执行机是否装了微信开发者工具。
    expect(r.combined).toContain(canonical);
    if (fs.existsSync(canonical)) {
      expect(r.status).toBe(0);
    } else {
      expect(r.status).not.toBe(0);
      expect(r.combined).toContain('不可执行');
    }
  });

  it('WECHAT_DEVTOOLS_CLI 指向不存在的文件 → 直接拒跑', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18'], {
      WECHAT_DEVTOOLS_CLI: path.join(fx.root, 'nope', 'cli'),
    });
    expect(r.status).not.toBe(0);
    expect(r.combined).toContain('不可执行');
    expect(fs.existsSync(path.join(fx.appRoot, '.ci-output', 'args.json'))).toBe(false);
  });
});

describe('release-one-shot.sh · S5/S6 留证', () => {
  it('S6 是单行 JSON，可 JSON.parse，字段与实测摘要齐全', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, [
      '--mode', 'preview', '--version', '1.0.18', '--desc', '单测用描述',
    ]);

    expect(r.status).toBe(0);

    const s6Line = lastNonEmptyLine(r.stdout);
    expect(s6Line.startsWith('{')).toBe(true);
    expect(s6Line).not.toContain('\n');
    const json = JSON.parse(s6Line);

    expect(json.EVIDENCE_LOCKED).toBe(true);
    expect(json.mode).toBe('preview');
    expect(json.version).toBe('1.0.18');
    expect(json.preflight).toBe('pass');
    expect(json.forcedDir).toBeNull();
    expect(json.reason).toBeUndefined();
    // gitSha 来自 tmp 目录里真实 git init 出来的 HEAD
    expect(json.gitSha).toMatch(/^[0-9a-f]{8}$/);

    expect(json.qr).toBeTruthy();
    expect(path.isAbsolute(json.qr.path)).toBe(true);
    expect(fs.existsSync(json.qr.path)).toBe(true);
    expect(json.qr.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(String(json.qr.expireAt)).toContain('2026-11-26');
  });

  it('qr.sha256 与 shasum -a 256 逐字符一致（真算，不是猜的）', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18']);
    expect(r.status).toBe(0);

    const json = JSON.parse(lastNonEmptyLine(r.stdout));
    const shasumOut = execFileSync('shasum', ['-a', '256', json.qr.path], { encoding: 'utf8' });
    const expected = shasumOut.trim().split(/\s+/)[0];
    expect(json.qr.sha256).toBe(expected);
  });

  it('三行 [QR] 格式固定，remaining 是现算的整数分钟', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18']);
    expect(r.status).toBe(0);

    const qrLines = r.stdout.split('\n').filter((l) => l.startsWith('[QR] '));
    const pathLine = qrLines.find((l) => l.startsWith('[QR] path='));
    const shaLine = qrLines.find((l) => l.startsWith('[QR] sha256='));
    const expLine = qrLines.find((l) => l.startsWith('[QR] expireAt='));

    expect(pathLine).toBeTruthy();
    expect(shaLine).toBeTruthy();
    expect(expLine).toBeTruthy();
    // 桩里 expireAtMs = now + 25 分钟 → 现算必然是 24~25，不能是写死的字符串
    const m = /remaining=(-?\d+)/.exec(expLine as string);
    expect(m).toBeTruthy();
    const remaining = Number((m as RegExpExecArray)[1]);
    expect(remaining).toBeGreaterThanOrEqual(24);
    expect(remaining).toBeLessThanOrEqual(25);
  });

  it('--desc 与 --mode 原样透传给 publish.js，--no-push 只在显式传入时透传', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, [
      '--mode', 'preview', '--version', '1.0.18', '--desc', '首页动态问候', '--no-push',
    ]);
    expect(r.status).toBe(0);

    const argsPath = path.join(fx.appRoot, '.ci-output', 'args.json');
    const passed = JSON.parse(fs.readFileSync(argsPath, 'utf8')) as string[];
    expect(passed[0]).toBe('preview');
    expect(passed).toContain('--desc');
    expect(passed[passed.indexOf('--desc') + 1]).toBe('首页动态问候');
    expect(passed).toContain('--no-push');

    const fx2 = track(makeFixture('web_system-1018-oneshot-'));
    const r2 = runScript(fx2, ['--mode', 'preview', '--version', '1.0.18']);
    expect(r2.status).toBe(0);
    const passed2 = JSON.parse(
      fs.readFileSync(path.join(fx2.appRoot, '.ci-output', 'args.json'), 'utf8'),
    ) as string[];
    expect(passed2).not.toContain('--no-push');
  });

  it('preflight 失败 → 停在 S1、不透传 --skip-preflight、S6 标未锁住', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    // 换成必定失败的 preflight 桩
    fs.writeFileSync(
      path.join(fx.appRoot, 'scripts', 'preflight.js'),
      `'use strict';
process.stderr.write('[Preflight] ❌ [P1] utils/version.ts 不存在\\n');
process.exit(1);
`,
    );
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18']);

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('[P1] utils/version.ts 不存在');
    expect(r.combined).toContain('S1 preflight 未通过');
    expect(fs.existsSync(path.join(fx.appRoot, '.ci-output', 'args.json'))).toBe(false);

    const json = JSON.parse(lastNonEmptyLine(r.stderr));
    expect(json.EVIDENCE_LOCKED).toBe(false);
    expect(json.preflight).toBe('fail');
    expect(String(json.reason)).toContain('S1');
  });

  it('upload 模式：不产二维码，S6 的 qr 为 null', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, ['--mode', 'upload', '--version', '1.0.18', '--desc', '测试上传']);
    expect(r.status).toBe(0);

    const json = JSON.parse(lastNonEmptyLine(r.stdout));
    expect(json.EVIDENCE_LOCKED).toBe(true);
    expect(json.mode).toBe('upload');
    expect(json.qr).toBeNull();
    expect(r.stdout).toContain('[S5] upload 已完成');
  });
});
