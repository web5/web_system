/// <reference types="node" />
/**
 * 门禁「下沉到出码入口本体」（台账 9122）
 *
 * 🔴 本文件要钉住的**不是**判据逻辑（那在 preflight.test.ts），而是三件接线事实：
 *
 *   E1 · 直连 `node scripts/preview.js` / `node scripts/upload.js` 时，门禁**先于**任何出码动作
 *        执行。改这条之前 `grep -c preflight scripts/preview.js = 0` —— 知道文件名就能绕过
 *        整套 P1–P6（preview-push.js 就是这么 spawn 的）。
 *
 *   E2 · `publish.js preview --mode ci` 这条链上，门禁**只跑一次**（报表出现 1 次，不是 2 次）。
 *        编排下沉后 publish.js 会先跑一次，preview.js 本体也会跑一次；不去重就是两份报表，
 *        出问题时没人分得清哪份是真判据。机制见 preflight.GATE_ENV。
 *
 *   E3 · `scripts/preview-push.js` 不再自带任何门禁判据（只剩「透传参数」+「推送运行时前置」）。
 *
 * 🔴 关于「不许真出码」：本文件里凡是会走完门禁、继续往下跑的用例，一律注入
 *    MINIPROGRAM_CI_PATH=<不存在的目录>，让 `require(miniprogram-ci)` 必然炸掉 ——
 *    走不到网络请求、也走不到写二维码。本该失败的门禁用例则同时带 --expect-version 9.9.9。
 *    另断言 `.ci-output` 文件数跑前跑后一致（零新增产物）。
 *
 * 为什么用子进程而不是 require：preview.js / upload.js 都是「顶部即执行」的脚本（没有
 * `require.main === module` 保护，也不该加），require 进来会真的跑一遍。子进程还能同时
 * 验到「退出码」和「stdout/stderr 的先后顺序」—— 这两样恰恰是本台账的核心证据。
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

jest.setTimeout(120000);

interface GateModule {
  runGateOrExit: (
    opts?: Record<string, unknown>,
    sub?: 'preview' | 'upload',
    ctx?: {
      env?: Record<string, string | undefined>;
      log?: (...a: unknown[]) => void;
      warn?: (...a: unknown[]) => void;
      exit?: (code: number) => void;
    },
  ) => { ok: boolean; skipped?: boolean; failures?: unknown[] };
  withGateState: (
    env: Record<string, string | undefined>,
    state?: string,
  ) => Record<string, string | undefined>;
  parsePreflightArgs: (argv: string[]) => Record<string, unknown> & { _: string[] };
  GATE_ENV: string;
  GATE_DONE: string;
  GATE_SKIP: string;
}

interface PublishModule {
  childGateState: (gate: unknown, opts: { skipPreflight?: boolean }) => string | undefined;
}

const preflight = require('../scripts/preflight') as GateModule;
const publish = require('../scripts/publish') as PublishModule;

const APP_ROOT = path.join(__dirname, '..');
/** 必然失败的 ci 依赖根：门禁一旦放行，下一句 require 就炸，绝不产生真实出码。 */
const NO_CI_ENV = { MINIPROGRAM_CI_PATH: path.join(APP_ROOT, 'no-such-mp-ci-9122') };

interface RunResult {
  status: number | null;
  /** stdout + stderr 合并（只看「说了什么」，不看走哪个流） */
  out: string;
}

/** 跑一个真实脚本（子进程）。extraEnv 覆盖在 NO_CI_ENV 之后，便于个别用例定制。 */
function runScript(
  relScript: string,
  args: string[] = [],
  extraEnv: Record<string, string> = {},
): RunResult {
  const r = spawnSync(process.execPath, [path.join(APP_ROOT, relScript), ...args], {
    cwd: APP_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, ...NO_CI_ENV, ...extraEnv },
    timeout: 60000,
  });
  const stdout = r.stdout == null ? '' : String(r.stdout);
  const stderr = r.stderr == null ? '' : String(r.stderr);
  return { status: r.status, out: `${stdout}${stderr}` };
}

/** 数一个字符串里出现几次（不用正则，避免 needle 里的特殊字符转义坑）。 */
function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** 报表抬头（printReport 的第一行，唯一标识「跑了一次门禁」）。 */
const REPORT_HEAD = '出码前检查（P1–P6';

/** `.ci-output` 里的文件数（递归；目录不存在算 0）。 */
function ciOutputFileCount(): number {
  const root = path.join(APP_ROOT, '.ci-output');
  const walk = (dir: string): number => {
    let n = 0;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      n += fs.statSync(full).isDirectory() ? walk(full) : 1;
    }
    return n;
  };
  return fs.existsSync(root) ? walk(root) : 0;
}

// ============================================================ E1 直连被门禁拦住

describe('E1 · 直连 preview.js / upload.js：门禁先于出码动作执行', () => {
  it('直连 preview.js 且声明了不可能满足的版本/sha → 被门禁拦下（exit 1，一份报表）', () => {
    const before = ciOutputFileCount();
    const r = runScript('scripts/preview.js', [
      '--expect-version', '9.9.9',
      '--expect-sha', '00000000',
    ]);

    expect(r.status).toBe(1);
    // ① 门禁确实跑了，而且只跑一次
    expect(countOf(r.out, REPORT_HEAD)).toBe(1);
    // ② 顺序证据：输出里第一个 [Preflight]/[Preview] 标签必须是 Preflight
    //    （改造前这里是 [Preview] 缺少私钥 —— 出码动作抢在门禁前面）
    const tags = r.out.match(/\[(Preflight|Preview)\]/g) || [];
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0]).toBe('[Preflight]');
    // ③ 拦下来的是 P1/P3 判据本身，不是别的错
    expect(r.out).toContain('package.json 版本 ≠ 期望版本');
    expect(r.out).toContain('HEAD 与期望 sha 不符');
    // ④ 出码动作一句都没开始（previewApp 的头两句日志）
    expect(r.out).not.toContain('[Preview] appid');
    expect(r.out).not.toContain('[Preview] 版本:');
    // ⑤ 零产物
    expect(ciOutputFileCount()).toBe(before);
  });

  it('直连 upload.js 同样被门禁拦下（两个入口一个都不能漏）', () => {
    const r = runScript('scripts/upload.js', ['--expect-version', '9.9.9']);

    expect(r.status).toBe(1);
    expect(countOf(r.out, REPORT_HEAD)).toBe(1);
    const tags = r.out.match(/\[(Preflight|Upload)\]/g) || [];
    expect(tags[0]).toBe('[Preflight]');
    expect(r.out).toContain('package.json 版本 ≠ 期望版本');
    // 上传动作没开始
    expect(r.out).not.toContain('[Upload] 开始上传');
    expect(r.out).not.toContain('[Upload] 版本号:');
  });

  it('--allow-any-dir 在直连路径下也生效（P4 降级为告警，不是硬拦）', () => {
    // 断言「透传链完整」：参数被同一条解析器认出来
    expect(preflight.parsePreflightArgs(['--allow-any-dir']).allowAnyDir).toBe(true);

    // 断言「真的到了 P4」：allowAnyDir=true 且未给 --require-dir 时，preflight 必定打印
    // 「已放行白名单外目录」或「本就在白名单内，开关本次未生效」二者之一 —— 与目录名无关。
    const r = runScript('scripts/preview.js', ['--expect-version', '9.9.9', '--allow-any-dir']);
    const escaped = r.out.includes('已用 --allow-any-dir 显式放行白名单外目录')
      || r.out.includes('已声明 --allow-any-dir，但当前目录');
    expect(escaped).toBe(true);
    // 而且 P4 不再出现在失败项里
    expect(r.out).not.toContain('[P4] 项目目录不在出码白名单');
  });

  it('--skip-preflight 在直连路径下可用，且打印「风险自负」（逃生口不许被门禁吃掉）', () => {
    const r = runScript('scripts/preview.js', ['--skip-preflight']);

    // 跳过了门禁 → 继续往下跑 → 撞上没有 miniprogram-ci 的运行环境（必然失败，不出码）
    expect(r.status).not.toBe(0);
    expect(r.out).toContain('已跳过出码前检查，风险自负');
    // 关键：跳过时**不许**再打印门禁报表（否则「跳过」就是假的）
    expect(countOf(r.out, REPORT_HEAD)).toBe(0);
  });
});

// ============================================================ E2 只跑一次

describe('E2 · publish.js preview --mode ci：同一条链上门禁只跑一次', () => {
  it('报表只出现 1 次（不是 2 次），且子进程打出「不重复执行」的痕', () => {
    const before = ciOutputFileCount();
    const r = runScript('scripts/publish.js', [
      'preview', '--mode', 'ci', '--allow-any-dir', '--allow-dirty',
    ]);

    // 门禁通过 → 进 cmdPreview → spawn preview.js → 它撞上不存在的 miniprogram-ci（必然失败）
    expect(r.status).toBe(1);
    // 🔴 本用例的核心断言：两份报表 = 两个判据来源 = 迟早漂
    expect(countOf(r.out, REPORT_HEAD)).toBe(1);
    // 证明「去重机制真的被触发过」，而不是「子进程压根没起来」那种假绿
    expect(countOf(r.out, '本入口不重复执行')).toBe(1);
    // 门禁本身是通过的（否则根本走不到子进程，本用例会假绿）
    expect(r.out).toContain('六项检查通过，可以出码');
    expect(ciOutputFileCount()).toBe(before);
  });

  it('子进程是被显式标注「上游已跑过」，而不是靠猜（GATE_ENV 取值）', () => {
    expect(publish.childGateState({ ok: true }, {})).toBe(preflight.GATE_DONE);
    expect(publish.childGateState({ ok: true, skipped: true }, { skipPreflight: true }))
      .toBe(preflight.GATE_SKIP);
    // 没跑过门禁（单测直接调 cmdPreview / cmdUpload，或将来有人绕开 main）→ 必须返回空，
    // 让子进程自己跑门禁。绝不出现「谁都没跑却都说跑过」的空窗。
    expect(publish.childGateState(undefined, {})).toBeUndefined();
  });

  it('runGateOrExit：继承 GATE_DONE 时不做判定、只打一行痕（不再出第二份报表）', () => {
    const logs: string[] = [];
    let exited: number | null = null;
    const result = preflight.runGateOrExit(
      { root: path.join(APP_ROOT, 'no-such-package-root-9122') }, // 这个 root 必定判失败
      'preview',
      {
        env: { [preflight.GATE_ENV]: preflight.GATE_DONE },
        log: (...a: unknown[]) => logs.push(a.map(String).join(' ')),
        exit: (code: number) => { exited = code; },
      },
    );

    expect(result.skipped).toBe(true);
    expect(exited).toBeNull(); // 没判定 → 不会 exit（哪怕 root 是必败的）
    const out = logs.join('\n');
    expect(out).toContain('本入口不重复执行');
    expect(out).not.toContain(REPORT_HEAD);
  });

  it('runGateOrExit：继承 GATE_SKIP 时同样不判定（上游已显式跳过），但要留一句风险痕迹', () => {
    const warns: string[] = [];
    let exited: number | null = null;
    const result = preflight.runGateOrExit(
      { root: path.join(APP_ROOT, 'no-such-package-root-9122') },
      'preview',
      {
        env: { [preflight.GATE_ENV]: preflight.GATE_SKIP },
        log: () => {},
        warn: (...a: unknown[]) => warns.push(a.map(String).join(' ')),
        exit: (code: number) => { exited = code; },
      },
    );

    expect(result.skipped).toBe(true);
    expect(exited).toBeNull();
    // 跳过也必须留痕（不静默），且不许夹带报表
    expect(warns.join('\n')).toContain('风险自负');
    expect(warns.join('\n')).not.toContain(REPORT_HEAD);
  });

  it('withGateState：状态为空时**不继承**父进程残留值（父 shell 有 done 也不能自动开门）', () => {
    const inherited = { [preflight.GATE_ENV]: preflight.GATE_DONE, FOO: '1' };
    expect(preflight.withGateState(inherited, undefined)).not.toHaveProperty(preflight.GATE_ENV);
    expect(preflight.withGateState(inherited, preflight.GATE_DONE)).toEqual({
      [preflight.GATE_ENV]: 'done',
      FOO: '1',
    });
  });
});

// ============================================================ E3 preview-push 去重

describe('E3 · preview-push.js 不再自带门禁判据（只剩透传 + 推送运行时前置）', () => {
  const src = fs.readFileSync(path.join(APP_ROOT, 'scripts', 'preview-push.js'), 'utf-8');

  it('不出现任何判据标识符（P1 版本对账 / P4 目录白名单 / 私钥判据）', () => {
    expect(src).not.toContain('runPreflight');
    expect(src).not.toContain('printReport');
    expect(src).not.toContain('ALLOWED_DIR_NAME');
    expect(src).not.toContain('expectVersion');
    expect(src).not.toContain('isKeyFile');
    expect(src).not.toContain('KEY_EXT');
    // 目录白名单的形态（web_system-<四位任务号>）不再出现在这里
    expect(src).not.toMatch(/web_system-\d{4}/);
  });

  it('也不再自己查私钥（P2 的事；preview.js 本体与 preflight.js 各管一段，不在这里第三份）', () => {
    expect(src).not.toContain('private.key');
    expect(src).not.toMatch(/\.key\b/);
  });

  it('但保留推送链路的运行时前置检查（wecom-cli 授权 / miniprogram-ci 可加载）', () => {
    expect(src).toContain('wecom-cli');
    expect(src).toContain('auth');
    expect(src).toContain('miniprogram-ci');
    expect(src).toContain('checkPushRuntime');
  });

  it('把门禁参数**透传**给 preview.js（本脚本不解释、不判定）', () => {
    expect(src).toContain('--expect-version');
    expect(src).toContain('--expect-sha');
    expect(src).toContain('--require-dir');
    expect(src).toContain('--allow-any-dir');
    expect(src).toContain('--skip-preflight');
    expect(src).toContain('gateArgs');
  });

  it('不把自己没跑过的门禁说成「跑过了」（必须清掉 GATE_ENV 残留）', () => {
    expect(src).toContain('delete env[GATE_ENV]');
  });
});

// ============================================================ 判据唯一性（结构性绊线）

describe('判据只有一份：入口只调 runGateOrExit，不复制判据', () => {
  const read = (p: string) => fs.readFileSync(path.join(APP_ROOT, 'scripts', p), 'utf-8');

  /**
   * 去掉注释后再断言：本组管的是「**代码**里有没有第二份编排/判据」，
   * 注释里写「本文件调 runPreflight 之外不做事」这种说明不该判红（否则只能靠不写注释来变绿）。
   * `(^|[^:])` 是为了不把 `https://…` 当行注释切掉。
   */
  const codeOnly = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('preview.js / upload.js 各调一次 runGateOrExit，且都不直接调 runPreflight', () => {
    for (const file of ['preview.js', 'upload.js']) {
      const code = codeOnly(read(file));
      expect(countOf(code, 'runGateOrExit(')).toBe(1);
      expect(code).not.toContain('runPreflight');
      expect(code).not.toContain('ALLOWED_DIR_NAME');
      expect(code).not.toContain('printReport');
    }
  });

  it('publish.js 不直接 runPreflight / printReport（编排只在 preflight.js 一份）', () => {
    const code = codeOnly(read('publish.js'));
    expect(code).not.toContain('runPreflight');
    expect(code).not.toContain('printReport');
    expect(countOf(code, 'runGateOrExit(')).toBe(1);
  });

  it('判据关键词只在 preflight.js 的代码里出现（没有第二处实现）', () => {
    const entries = fs.readdirSync(path.join(APP_ROOT, 'scripts')).filter((f) => f.endsWith('.js'));
    for (const file of entries) {
      if (file === 'preflight.js') continue;
      const code = codeOnly(read(file));
      // 除 preflight.js 外，任何文件出现「白名单正则的实现」= 判据被复制了
      expect(code).not.toContain('ALLOWED_DIR_NAME');
      // 也不许自己写一份「包根出现 *.key → 失败」的判据
      expect(code).not.toMatch(/KEY_EXT|isKeyFile/);
    }
  });
});
