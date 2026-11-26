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
 *      sha256 与外部 sha256 工具（shasum / sha256sum）逐字符一致（不是从文件名/时间猜出来的）。
 *
 * 隔离手段：
 *   · 不跑真实出码/上传。临时目录里放 scripts/preflight.js 与 scripts/publish.js 两个桩，
 *     publish 桩只写假的 png + meta.json，命令行参数原样落到 .ci-output/args.json 供断言。
 *   · 临时目录 git init 一次，让 gitSha 走真实的 `git rev-parse --short=8` 分支。
 *   · 临时目录里再造一个可执行的「微信开发者工具 CLI」桩：脚本前置的 `-x` 检查必须过，
 *     但**不能靠执行机装没装工具**（PR #698 CI 全红就是这么来的，见 makeFixture 注释）。
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
  /** worktree 顶层目录（git toplevel；S2 判的就是它的 basename） */
  worktreeRoot: string;
  appRoot: string;
  script: string;
  /**
   * 夹具里自带的「微信开发者工具 CLI」桩（可执行）。
   * 脚本前置只对它做 `-x` 检查，S1/S4 用的是 preflight/publish 桩，所以它永远不会被真正执行。
   * 见 makeFixture 里的注释：不给它，测试就变成了「本机装没装微信开发者工具」。
   */
  stubCli: string;
  cleanup: () => void;
}

/**
 * 造一个临时 worktree 形状：
 *   <root>[/<topName>]/apps/dachengzi-minigram/scripts/{release-one-shot.sh, preflight.js, publish.js}
 * topName 用来把 worktree 顶层名钉成指定值（S2 的正则就判它）。
 * 不传 topName 时顶层名 = mkdtemp 出来的 `prefixXXXXXX`，由调用方按需给正则。
 */
function makeFixture(prefix: string, topName?: string): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const worktreeRoot = topName ? path.join(root, topName) : root;
  const appRoot = path.join(worktreeRoot, 'apps', 'dachengzi-minigram');
  const scriptsDir = path.join(appRoot, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  const script = path.join(scriptsDir, 'release-one-shot.sh');
  fs.copyFileSync(SCRIPT_SRC, script);
  fs.chmodSync(script, 0o755);

  fs.writeFileSync(path.join(scriptsDir, 'preflight.js'), STUB_PREFLIGHT);
  fs.writeFileSync(path.join(scriptsDir, 'publish.js'), STUB_PUBLISH);

  // 🔴 宿主无关的 CLI（2026-11-26 PR #698 CI 全红的根因就出在这里）：
  // release-one-shot.sh 的前置步骤要求 WECHAT_DEVTOOLS_CLI（未设时回落到**硬编码的 macOS
  // 官方安装路径** /Applications/wechatwebdevtools.app/Contents/MacOS/cli）存在且可执行。
  // 若测试只 delete 环境变量，就等于把「执行机装没装微信开发者工具」写进了断言：
  //   · 开发者本机（macOS，装了工具）→ 前置通过，19 条全绿；
  //   · CI runner（Ubuntu，没装工具）→ 前置 die，脚本在 S0 之后立刻退出，
  //     S1/S2/S4/S5/S6 一步都走不到，除参数校验外的用例全红。
  // 所以在夹具里现造一个必然可执行的桩，让「CLI 就绪」成为夹具自带的事实，而不是环境事实。
  // 注意：这不是「放宽断言」—— CLI 缺失/不可执行那两个分支由「CLI 前置」describe 里的
  // 三条用例专门钉住（其中「未设 WECHAT_DEVTOOLS_CLI 且回落路径不存在」是确定性用例）。
  const stubCli = path.join(root, 'fake-wechat-devtools-cli');
  fs.writeFileSync(stubCli, '#!/usr/bin/env bash\nexit 0\n');
  fs.chmodSync(stubCli, 0o755);

  // 让 gitSha 走真实分支，同时让 S2 的 `git rev-parse --show-toplevel` 命中 worktreeRoot：
  // 空提交即可，git 只关心有没有 HEAD。
  execFileSync('git', ['init', '-q'], { cwd: worktreeRoot });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit',
    '-q', '--allow-empty', '-m', 'fixture'], { cwd: worktreeRoot });

  return {
    root,
    worktreeRoot,
    appRoot,
    script,
    stubCli,
    cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

/** 把 worktree 顶层名转成「精确匹配它」的正则（夹具名里只有 - 和字母数字，仍统一转义）。 */
function exactDirRe(fx: Fixture): string {
  const name = path.basename(fx.worktreeRoot);
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/**
 * 必填三件套 + 额外参数。
 * `--require-dir` 是**必填无默认**的（脚本不给目录判据兜底值），
 * 所以每条要跑到 S4 之后的用例都必须显式给它。
 */
function stdArgs(fx: Fixture, extra: string[] = [], mode = 'preview'): string[] {
  return ['--mode', mode, '--version', '1.0.18', '--require-dir', exactDirRe(fx), ...extra];
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
  // 默认给夹具自带的 CLI 桩，让用例与「执行机装没装微信开发者工具」解耦。
  // 显式在 extraEnv 里传 WECHAT_DEVTOOLS_CLI / WECHAT_DEVTOOLS_CLI_DEFAULT（含传 undefined 删掉）
  // 的用例仍然按自己的意图走 —— 下面那个循环后执行，优先级更高。
  env.WECHAT_DEVTOOLS_CLI = fx.stubCli;
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

/**
 * 拿**外部工具**对文件真算一遍 sha256（不复用被测脚本的实现，避免自证）。
 * macOS 自带 shasum；精简 Linux 镜像可能只有 coreutils 的 sha256sum。
 * 顺序与 release-one-shot.sh 的 sha256_of() 一致，但这里是独立跑一遍再逐字符比对。
 */
function externalSha256(file: string): string {
  const candidates: Array<[string, string[]]> = [
    ['shasum', ['-a', '256', file]],
    ['sha256sum', [file]],
  ];
  for (const [cmd, args] of candidates) {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8' }).trim().split(/\s+/)[0];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; // 该工具不存在 → 换下一个
      throw err;
    }
  }
  throw new Error('既找不到 shasum 也找不到 sha256sum，无法独立验证二维码摘要');
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
    const r = runScript(fx, stdArgs(fx), {}, os.tmpdir());

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

describe('release-one-shot.sh · --require-dir 必填与判据合一', () => {
  const ROUND_RE = '^web_system-1018(-r2)?$';

  it('缺少 --require-dir → 拒跑（不给默认目录判据，也不许蒙混）', () => {
    const fx = track(makeFixture('web_system-1018-r2-', 'web_system-1018-r2'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18']);

    expect(r.status).not.toBe(0);
    expect(r.combined).toContain('缺少 --require-dir');
    // 提示里必须点明「别写 ^web_system-1018$（旧树已提审）」，否则人第一反应就是填它
    expect(r.combined).toContain('019d282b');
    expect(fs.existsSync(path.join(fx.appRoot, '.ci-output', 'args.json'))).toBe(false);
  });

  it('--require-dir 不是合法正则 → 拒跑，且报错说的是正则而不是 JS 堆栈', () => {
    const fx = track(makeFixture('web_system-1018-r2-', 'web_system-1018-r2'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18',
      '--require-dir', '^web_system-1018(-r2$']);

    expect(r.status).not.toBe(0);
    expect(r.combined).toContain('不是合法正则');
    expect(r.combined).not.toContain('SyntaxError');
  });

  it('同一条正则喂两处：S1 preflight 与 S4 publish 都收到 --require-dir', () => {
    const fx = track(makeFixture('web_system-1018-r2-', 'web_system-1018-r2'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18',
      '--require-dir', ROUND_RE]);

    expect(r.status).toBe(0);

    // ① S1：preflight 桩把 argv 原样打出来 → 直接 grep 参数拼装（没有真跑 preflight）
    const m = /\[Preflight\] stub argv=(\[.*\])/.exec(r.stdout);
    expect(m).toBeTruthy();
    const argv = JSON.parse((m as RegExpExecArray)[1]) as string[];
    expect(argv).toContain('--require-dir');
    expect(argv[argv.indexOf('--require-dir') + 1]).toBe(ROUND_RE);
    expect(argv).toContain('--expect-version');

    // ② S4：publish 桩把收到的参数写进 .ci-output/args.json
    const passed = JSON.parse(
      fs.readFileSync(path.join(fx.appRoot, '.ci-output', 'args.json'), 'utf8'),
    ) as string[];
    expect(passed).toContain('--require-dir');
    expect(passed[passed.indexOf('--require-dir') + 1]).toBe(ROUND_RE);
    expect(passed).not.toContain('--allow-any-dir');
  });
});

describe('release-one-shot.sh · S2 目录硬检（用与 P4 同一条正则，不是子串）', () => {
  const ROUND_RE = '^web_system-1018(-r2)?$';

  it('名字里含 web_system-1018 但正则不匹配（web_system-1018-old）→ 必拦', () => {
    // 旧的子串判据 `[[ "$PWD" != *"web_system-1018"* ]]` 会放过这个名字 ——
    // 这条用例就是「判据已换成正则」的证明。
    const fx = track(makeFixture('oneshot-', 'web_system-1018-old'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18',
      '--require-dir', ROUND_RE]);

    expect(r.status).not.toBe(0);
    expect(r.combined).toContain('目录硬检未通过');
    expect(r.combined).toContain('web_system-1018-old');
    expect(r.combined).toContain(ROUND_RE);
    expect(fs.existsSync(path.join(fx.appRoot, '.ci-output', 'args.json'))).toBe(false);

    const json = JSON.parse(lastNonEmptyLine(r.stderr));
    expect(json.EVIDENCE_LOCKED).toBe(false);
    expect(json.requiredDir).toBe(ROUND_RE);
  });

  it('web_system-1018-r2 在 ^web_system-1018(-r2)?$ 下通过，且报出判据', () => {
    const fx = track(makeFixture('oneshot-', 'web_system-1018-r2'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18',
      '--require-dir', ROUND_RE]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`[S2] 目录硬检通过：web_system-1018-r2 匹配 /${ROUND_RE}/`);
    const json = JSON.parse(lastNonEmptyLine(r.stdout));
    expect(json.requiredDir).toBe(ROUND_RE);
  });

  it('危险目录 web_system-dachengzi → 非 0 退出、点名它、且不进入 S4', () => {
    const fx = track(makeFixture('web_system-dachengzi-oneshot-'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18',
      '--require-dir', ROUND_RE]);

    expect(r.status).not.toBe(0);
    expect(r.combined).toContain('目录硬检未通过');
    // 必须点名那个真实的危险路径，否则人看不懂为什么被拦
    expect(r.combined).toContain('web_system-dachengzi');
    expect(r.combined).toContain('private.key');
    // 被拦在 S4 之前：publish 桩一次都没被调用
    expect(fs.existsSync(path.join(fx.appRoot, '.ci-output', 'args.json'))).toBe(false);
    const json = JSON.parse(lastNonEmptyLine(r.stderr));
    expect(json.EVIDENCE_LOCKED).toBe(false);
    expect(String(json.reason)).toContain('S2');
  });

  it('--force-dir 放行：跳过 S2、把 P4 降为 --allow-any-dir，理由写进 S6 forcedDir', () => {
    const fx = track(makeFixture('web_system-dachengzi-oneshot-'));
    const reason = '测试理由：仅单测桩目录';
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18',
      '--require-dir', ROUND_RE, '--force-dir', reason]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[S2] ⚠️⚠️ 目录硬检已被 --force-dir 跳过');
    expect(r.stdout).toContain(reason);

    // --force-dir 必须同时放开 S1 的 P4，否则「跳过 S2」是假的（S1 会先红）
    const m = /\[Preflight\] stub argv=(\[.*\])/.exec(r.stdout);
    expect(m).toBeTruthy();
    const preflightArgv = JSON.parse((m as RegExpExecArray)[1]) as string[];
    expect(preflightArgv).toContain('--allow-any-dir');
    expect(preflightArgv).not.toContain('--require-dir');

    const json = JSON.parse(lastNonEmptyLine(r.stdout));
    expect(json.forcedDir).toBe(reason);
    expect(json.EVIDENCE_LOCKED).toBe(true);
  });

  it('--force-dir 的理由太短也拒跑（堵「随便写两个字糊过去」）', () => {
    const fx = track(makeFixture('web_system-dachengzi-oneshot-'));
    const r = runScript(fx, ['--mode', 'preview', '--version', '1.0.18',
      '--require-dir', ROUND_RE, '--force-dir', '要']);
    expect(r.status).not.toBe(0);
    expect(r.combined).toContain('理由太短');
  });
});

describe('release-one-shot.sh · CLI 前置（必须在 S1 之前）', () => {
  it('WECHAT_DEVTOOLS_CLI 为空时回落到 WECHAT_DEVTOOLS_CLI_DEFAULT 且校验可执行', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const stubCli = path.join(fx.root, 'fake-cli');
    fs.writeFileSync(stubCli, '#!/usr/bin/env bash\necho fake-cli\n');
    fs.chmodSync(stubCli, 0o755);

    const r = runScript(fx, stdArgs(fx), {
      WECHAT_DEVTOOLS_CLI: '',
      WECHAT_DEVTOOLS_CLI_DEFAULT: stubCli,
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain('[CLI] WECHAT_DEVTOOLS_CLI 未设置，回落官方安装路径：');
    expect(r.stdout).toContain(stubCli);
    expect(r.stdout).toContain(`[CLI] CLI 就绪：${stubCli}`);
    expect(r.stdout).toContain(`[S3] CLI 就绪：${stubCli}`);

    // 🔴 顺序断言：CLI 补齐必须发生在 S1 preflight **之前**。
    // 否则 P6 会把「没设环境变量」判成出码失败（S3 永远跑不到）。
    const iCli = r.stdout.indexOf('[CLI] WECHAT_DEVTOOLS_CLI 未设置');
    const iS1 = r.stdout.indexOf('[S1] 出码前预检');
    expect(iCli).toBeGreaterThanOrEqual(0);
    expect(iS1).toBeGreaterThanOrEqual(0);
    expect(iCli).toBeLessThan(iS1);
  });

  it('回落链末端的官方路径恒被点名（本机没装时也不会默默 ENOENT）', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const canonical = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
    const r = runScript(fx, stdArgs(fx), {
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
    const r = runScript(fx, stdArgs(fx), {
      WECHAT_DEVTOOLS_CLI: path.join(fx.root, 'nope', 'cli'),
    });
    expect(r.status).not.toBe(0);
    expect(r.combined).toContain('不可执行');
    expect(fs.existsSync(path.join(fx.appRoot, '.ci-output', 'args.json'))).toBe(false);
  });

  /**
   * 🔴 这条是 PR #698 CI 全红（2026-11-26）的**回归钉**。
   *
   * 上面那条「回落链末端的官方路径恒被点名」只能两个分支二选一 —— 在装了微信开发者工具的
   * macOS 上永远走成功分支，「回落的 CLI 不可执行」这一支**从来没人测过**；而 CI 的 Ubuntu
   * 恰好只走这一支，于是一次性红了 12 条用例。
   *
   * 这里把「回落路径不存在」做成确定性输入（WECHAT_DEVTOOLS_CLI_DEFAULT 指到不存在的文件），
   * 与执行机无关地钉住三件事：
   *   ① 会 die，且 die 在**前置**（S1 一次都没跑）—— 不是等 spawn ENOENT 才炸；
   *   ② 报错点名具体路径，人不用猜「缺的是哪个 env」；
   *   ③ S6 仍出一行可解析的结论（EVIDENCE_LOCKED:false / preflight:not-run）。
   */
  it('未设 WECHAT_DEVTOOLS_CLI 且回落路径不存在 → 死在「前置」，不进 S1', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const missing = path.join(fx.root, 'no-devtools', 'cli');
    const r = runScript(fx, stdArgs(fx), {
      WECHAT_DEVTOOLS_CLI: '',
      WECHAT_DEVTOOLS_CLI_DEFAULT: missing,
    });

    expect(r.status).not.toBe(0);
    // ① 报错点名路径 + 给出出路（显式指定 WECHAT_DEVTOOLS_CLI）
    expect(r.combined).toContain('[CLI] WECHAT_DEVTOOLS_CLI 未设置，回落官方安装路径：');
    expect(r.combined).toContain(missing);
    expect(r.combined).toContain('不可执行');
    expect(r.combined).toContain('WECHAT_DEVTOOLS_CLI=');
    // ② 死在 S1 之前：preflight 桩一次都没被执行（不是「跑完 S1 才报出码失败」）
    expect(r.stdout).not.toContain('[S1] 出码前预检');
    expect(r.stdout).not.toContain('[Preflight] stub');
    expect(fs.existsSync(path.join(fx.appRoot, '.ci-output', 'args.json'))).toBe(false);
    // ③ S6 仍是一行可解析的未锁住结论
    const json = JSON.parse(lastNonEmptyLine(r.stderr));
    expect(json.EVIDENCE_LOCKED).toBe(false);
    expect(json.preflight).toBe('not-run');
    expect(String(json.reason)).toContain('CLI 前置');
  });
});

describe('release-one-shot.sh · S5/S6 留证', () => {
  it('S6 是单行 JSON，可 JSON.parse，字段与实测摘要齐全', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, stdArgs(fx, ['--desc', '单测用描述']));

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
    expect(json.requiredDir).toBe(exactDirRe(fx));
    expect(json.reason).toBeUndefined();
    // gitSha 来自 tmp 目录里真实 git init 出来的 HEAD
    expect(json.gitSha).toMatch(/^[0-9a-f]{8}$/);

    expect(json.qr).toBeTruthy();
    expect(path.isAbsolute(json.qr.path)).toBe(true);
    expect(fs.existsSync(json.qr.path)).toBe(true);
    expect(json.qr.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(String(json.qr.expireAt)).toContain('2026-11-26');
  });

  it('qr.sha256 与外部 sha256 工具逐字符一致（真算，不是猜的）', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, stdArgs(fx));
    expect(r.status).toBe(0);

    const json = JSON.parse(lastNonEmptyLine(r.stdout));
    // 独立算一遍再比：不能是「从文件名/时间猜出来的」，也不能是脚本自己回声自己
    expect(json.qr.sha256).toBe(externalSha256(json.qr.path));
  });

  it('三行 [QR] 格式固定，remaining 是现算的整数分钟', () => {
    const fx = track(makeFixture('web_system-1018-oneshot-'));
    const r = runScript(fx, stdArgs(fx));
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
    const r = runScript(fx, stdArgs(fx, ['--desc', '首页动态问候', '--no-push']));
    expect(r.status).toBe(0);

    const argsPath = path.join(fx.appRoot, '.ci-output', 'args.json');
    const passed = JSON.parse(fs.readFileSync(argsPath, 'utf8')) as string[];
    expect(passed[0]).toBe('preview');
    expect(passed).toContain('--desc');
    expect(passed[passed.indexOf('--desc') + 1]).toBe('首页动态问候');
    expect(passed).toContain('--no-push');

    const fx2 = track(makeFixture('web_system-1018-oneshot-'));
    const r2 = runScript(fx2, stdArgs(fx2));
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
    const r = runScript(fx, stdArgs(fx));

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
    const r = runScript(fx, stdArgs(fx, ['--desc', '测试上传'], 'upload'));
    expect(r.status).toBe(0);

    const json = JSON.parse(lastNonEmptyLine(r.stdout));
    expect(json.EVIDENCE_LOCKED).toBe(true);
    expect(json.mode).toBe('upload');
    expect(json.qr).toBeNull();
    expect(r.stdout).toContain('[S5] upload 已完成');
  });
});
