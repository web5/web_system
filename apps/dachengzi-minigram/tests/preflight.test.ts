/// <reference types="node" />
/**
 * 出码前预检 scripts/preflight.js 单元测试
 *
 * 需求真源：`30-任务产物/2026-11-26-大橙子1018发布收口-独立盲测/`
 *           「出码前站位/版本/私钥三项检查脚本化并强制接进出码命令」
 *
 * 🔴 为什么每条都要断言「具体是哪一项失败」而不是只断言 ok===false：
 *    这些检查的价值在于「出了事能一眼看出踩的是哪颗雷」。只断言 ok 为假，
 *    等于允许「P2 私钥检查恒真、但被 P1 的误判遮住」这种假绿——
 *    本文件最后一组「真实炸弹」用例就是为此存在的：用真实的 1.0.14 + 真私钥目录验雷。
 *
 * 🔴 为什么要造临时目录而不是直接测本包：
 *    本包本身是「干净」的（版本一致、无私钥），只能覆盖通过路径；
 *    各类脏数据必须能被造出来（版本不一致 / version.ts 缺失 / private.key / foo.pem）。
 *
 * 🔴 本文件只读真实危险目录，不改它任何文件：#⑫ 组用例在跑前跑后比对
 *    private.key 的 sha256/size/mtime、package.json 内容、包根文件清单，全部必须不变。
 *
 * tsconfig 的 types 只有 wechat-miniprogram + jest，没有 node，
 * 故显式 `/// <reference types="node" />`（与本目录其它用例一致）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const preflight = require('../scripts/preflight') as PreflightModule;

interface Hit {
  path: string;
  name: string;
  size: number;
  mtime: string;
}

interface Failure {
  code: string;
  title: string;
  detail: string;
  hint?: string;
}

interface PreflightInfo {
  root: string;
  pkgVersion: string;
  appVersion: string;
  versionTsExists: boolean;
  expectVersion: string;
  branch: string;
  headSha: string;
  gitOk: boolean;
  expectSha: string;
  projectName: string;
  dirAllowed: boolean;
  rootKeyHits: Hit[];
  deepKeyHits: Hit[];
  warnings: string[];
}

interface PreflightResult {
  ok: boolean;
  failures: Failure[];
  info: PreflightInfo;
}

interface PreflightOpts {
  root?: string;
  expectVersion?: string;
  expectSha?: string;
  execFileSync?: (...args: unknown[]) => unknown;
}

interface PreflightModule {
  runPreflight: (opts?: PreflightOpts) => PreflightResult;
  printReport: (
    result: PreflightResult,
    io?: { log?: (...a: unknown[]) => void; error?: (...a: unknown[]) => void },
  ) => void;
  parsePreflightArgs: (argv: string[]) => {
    _: string[];
    root?: string;
    expectSha?: string;
    expectVersion?: string;
  };
  isSameSha: (a: string, b: string) => boolean;
  isKeyFile: (name: string) => boolean;
  ALLOWED_DIR_NAME: RegExp;
}

// ---------- 夹具 ----------

const tmpDirs: string[] = [];

/** 造一个「小程序包根」临时目录。opts 控制脏数据形态。 */
function mkFixture(opts: {
  version?: string;
  appVersion?: string;
  versionTs?: 'present' | 'absent';
  rawVersionTs?: string;
  keys?: string[];
  extraFiles?: string[];
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  tmpDirs.push(dir);

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: opts.version ?? '1.0.18' }, null, 2),
  );

  if (opts.versionTs !== 'absent') {
    fs.mkdirSync(path.join(dir, 'utils'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'utils', 'version.ts'),
      opts.rawVersionTs ?? `export const APP_VERSION = '${opts.appVersion ?? opts.version ?? '1.0.18'}';\n`,
    );
  }

  // 分两段：先把所有目录建完，再写文件 —— 沙箱 fs shim 在「刚 mkdir 完就写」时
  // 偶发 ENOENT，两段式可稳定复现不了那个竞态。
  const allFilePaths = [...(opts.keys ?? []), ...(opts.extraFiles ?? [])];
  for (const f of allFilePaths) {
    const dirOf = path.dirname(path.join(dir, f));
    if (dirOf !== dir) fs.mkdirSync(dirOf, { recursive: true });
  }

  for (const k of opts.keys ?? []) fs.writeFileSync(path.join(dir, k), 'PRIVATE KEY MATERIAL\n');
  for (const f of opts.extraFiles ?? []) fs.writeFileSync(path.join(dir, f), 'x');

  return dir;
}

/** 假 git：返回固定的分支/sha/toplevel，用来测 P3（真 git 在临时目录里读不到）。 */
function fakeGit(branch: string, sha: string, toplevel: string) {
  return (_cmd: unknown, args: unknown): string => {
    const a = (args as string[]).join(' ');
    if (a.includes('--abbrev-ref')) return `${branch}\n`;
    if (a.includes('--show-toplevel')) return `${toplevel}\n`;
    if (a.includes('--short')) return `${sha}\n`;
    throw new Error(`unexpected git args: ${a}`);
  };
}

const codes = (r: PreflightResult) => r.failures.map((f) => f.code);

afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ---------- ① P1 版本真实性 ----------

describe('P1 版本真实性', () => {
  it('package.json 与 utils/version.ts 字面相等 → 通过（干净目录）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root });

    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.info.pkgVersion).toBe('1.0.18');
    expect(r.info.appVersion).toBe('1.0.18');
    expect(r.info.versionTsExists).toBe(true);
  });

  it('两处版本不一致（1.0.18 vs 1.0.17）→ 失败，且指出两处各自的值', () => {
    const root = mkFixture({ version: '1.0.18', appVersion: '1.0.17' });
    const r = preflight.runPreflight({ root });

    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('P1');
    const f = r.failures.find((x) => x.title.includes('两处版本号不一致'));
    expect(f).toBeDefined();
    expect(f!.detail).toContain('1.0.18');
    expect(f!.detail).toContain('1.0.17');
  });

  it('utils/version.ts 不存在 → 失败（识别 1.0.14 老目录最灵敏的信号）', () => {
    const root = mkFixture({ version: '1.0.14', versionTs: 'absent' });
    const r = preflight.runPreflight({ root });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.title.includes('utils/version.ts 不存在'));
    expect(f).toBeDefined();
    expect(f!.detail).toContain('1.0.14');
    // 不能只报「不存在」：必须提示这是站错目录的强信号，否则读的人不知道该怎么办
    expect(f!.hint).toContain('站错目录');
  });

  it('version.ts 存在但读不到 APP_VERSION → 失败（不是「当它一致」放过去）', () => {
    const root = mkFixture({ version: '1.0.18', rawVersionTs: '// 空文件，忘写常量\n' });
    const r = preflight.runPreflight({ root });

    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.title.includes('读不到 APP_VERSION'))).toBe(true);
  });

  it('package.json.version ≠ 调用方声明的期望版本 → 失败（忘 bump / 站错目录）', () => {
    const root = mkFixture({ version: '1.0.14' });
    const r = preflight.runPreflight({ root, expectVersion: '1.0.18' });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.title.includes('package.json 版本 ≠ 期望版本'));
    expect(f).toBeDefined();
    expect(f!.detail).toContain('1.0.14');
    expect(f!.detail).toContain('1.0.18');
  });

  it('未声明期望版本时从 package.json 推导（两处相等即通过，不多要参数）', () => {
    const root = mkFixture({ version: '2.3.4' });
    const r = preflight.runPreflight({ root });

    expect(r.info.expectVersion).toBe('2.3.4');
    expect(r.ok).toBe(true);
  });
});

// ---------- ② P2 私钥不入包（P0 安全项） ----------

describe('P2 私钥不入包', () => {
  it('包根存在 private.key → 失败（P0，不是警告）', () => {
    const root = mkFixture({ version: '1.0.18', keys: ['private.key'] });
    const r = preflight.runPreflight({ root });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.code === 'P2');
    expect(f).toBeDefined();
    expect(f!.title).toContain('private.key');
    expect(f!.detail).toContain('private.key');
    expect(r.info.rootKeyHits.map((h) => h.name)).toContain('private.key');
    // 大小要报出来（便于和「1679 B 那一个」对上号），但绝不能打印密钥内容
    expect(f!.detail).toMatch(/\d+ B/);
    expect(f!.detail).not.toContain('PRIVATE KEY MATERIAL');
  });

  it('包根存在 foo.pem（不只 *.key）→ 失败', () => {
    const root = mkFixture({ version: '1.0.18', keys: ['foo.pem'] });
    const r = preflight.runPreflight({ root });

    expect(r.ok).toBe(false);
    expect(r.failures.find((x) => x.code === 'P2')!.title).toContain('foo.pem');
  });

  it('private.key.example 是模板，不算私钥（不制造假红）', () => {
    const root = mkFixture({ version: '1.0.18', keys: ['private.key.example'] });
    const r = preflight.runPreflight({ root });

    expect(r.ok).toBe(true);
    expect(r.info.rootKeyHits).toEqual([]);
  });

  it('干净目录 → 无密钥命中，通过', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root });

    expect(r.info.rootKeyHits).toEqual([]);
    expect(r.info.deepKeyHits).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('包根以外的密钥只进 warnings（不阻断，如实标注局限）', () => {
    const root = mkFixture({ version: '1.0.18', keys: ['prototype/upload.key'] });
    const r = preflight.runPreflight({ root });

    expect(r.ok).toBe(true); // 深层只警告：见回执「已知局限」
    expect(r.info.deepKeyHits.map((h) => h.name)).toContain('upload.key');
    expect(r.info.warnings.join('\n')).toContain('upload.key');
  });

  it('isKeyFile 白名单口径：.key/.pem 命中，.pub/.example/.txt 不命中', () => {
    expect(preflight.isKeyFile('private.key')).toBe(true);
    expect(preflight.isKeyFile('server.PEM')).toBe(true);
    expect(preflight.isKeyFile('public.pub')).toBe(false);
    expect(preflight.isKeyFile('private.key.example')).toBe(false);
    expect(preflight.isKeyFile('readme.txt')).toBe(false);
  });
});

// ---------- ③ P3 工作区身份 ----------

describe('P3 工作区身份（分支/sha）', () => {
  it('未声明 --expect-sha → 只打印，降级为 warning，不阻断', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root, execFileSync: fakeGit('main', 'abc1234', root) });

    expect(r.ok).toBe(true);
    expect(r.info.branch).toBe('main');
    expect(r.info.headSha).toBe('abc1234');
    expect(r.info.warnings.join('\n')).toContain('未声明 --expect-sha');
  });

  it('声明的 --expect-sha 与 HEAD 一致 → 通过（短 sha 前缀比对）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root, expectSha: 'abc1234', execFileSync: fakeGit('main', 'abc1234', root) });

    expect(r.ok).toBe(true);
    expect(r.info.warnings.join('\n')).toContain('--expect-sha 核对通过');
  });

  it('声明的 --expect-sha 与 HEAD 不符 → 失败（站错 worktree）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root, expectSha: '47f74ba8', execFileSync: fakeGit('main', 'abc1234', root) });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.code === 'P3');
    expect(f!.detail).toContain('47f74ba8');
    expect(f!.detail).toContain('abc1234');
  });

  it('声明了 --expect-sha 但 git 读不到 → 失败（不能「核不了就当通过」）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      expectSha: '47f74ba8',
      execFileSync: () => {
        throw new Error('not a git repository');
      },
    });

    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.code === 'P3' && f.title.includes('无法核对'))).toBe(true);
  });

  it('git 不可用且未声明期望 sha → 只警告，不阻断（纯目录也能查版本与私钥）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      execFileSync: () => {
        throw new Error('git: command not found');
      },
    });

    expect(r.ok).toBe(true);
    expect(r.info.gitOk).toBe(false);
    expect(r.info.warnings.join('\n')).toContain('读不到 git 身份');
  });

  it('isSameSha：短/全 sha 前缀互通，大小写不敏感，空值不相等', () => {
    expect(preflight.isSameSha('47f74ba8', '47f74ba8')).toBe(true);
    expect(preflight.isSameSha('47f74ba8', '47f74ba8d1c2e3')).toBe(true);
    expect(preflight.isSameSha('47F74BA8', '47f74ba8')).toBe(true);
    expect(preflight.isSameSha('47f74ba8', '019d282b')).toBe(false);
    expect(preflight.isSameSha('', '')).toBe(false);
  });
});

// ---------- ④ P4 目录白名单提示 ----------

describe('P4 目录白名单（只警告，不单独阻断）', () => {
  it('web_system-1018-r2 这类发布 worktree → 不告警', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      execFileSync: fakeGit('release/dachengzi-1018-r2', '47f74ba8', '/Users/x/workspace/web_system-1018-r2'),
    });

    expect(r.info.projectName).toBe('web_system-1018-r2');
    expect(r.info.dirAllowed).toBe(true);
    expect(r.info.warnings.join('\n')).not.toContain('P4');
  });

  it('web_system-dachengzi（危险目录的命名形态）→ 告警但不阻断', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      execFileSync: fakeGit('devtools/dachengzi-preview', '4292aa45', '/Users/x/workspace/web_system-dachengzi'),
    });

    expect(r.ok).toBe(true);
    expect(r.info.dirAllowed).toBe(false);
    expect(r.info.warnings.join('\n')).toContain('web_system-dachengzi');
  });

  it('ALLOWED_DIR_NAME：web_system / -1018 / -1018-r2 / -9027 收，-dachengzi / -pkgkey 不收', () => {
    for (const ok of ['web_system', 'web_system-1018', 'web_system-1018-r2', 'web_system-9027']) {
      expect(preflight.ALLOWED_DIR_NAME.test(ok)).toBe(true);
    }
    for (const bad of ['web_system-dachengzi', 'web_system-pkgkey', 'dachengzi-minigram', 'web_system-1018-r2-copy']) {
      expect(preflight.ALLOWED_DIR_NAME.test(bad)).toBe(false);
    }
  });
});

// ---------- ⑤ 报告输出 ----------

describe('printReport：失败项打 stderr，通过打 stdout', () => {
  it('失败时把每一项的 code/标题/处置都打出来', () => {
    const root = mkFixture({ version: '1.0.14', versionTs: 'absent', keys: ['private.key'] });
    const r = preflight.runPreflight({ root });
    const out: string[] = [];
    const err: string[] = [];

    preflight.printReport(r, { log: (s: unknown) => out.push(String(s)), error: (s: unknown) => err.push(String(s)) });

    const errText = err.join('\n');
    expect(errText).toContain('[P1]');
    expect(errText).toContain('[P2]');
    expect(errText).toContain('private.key');
    expect(errText).toContain('--skip-preflight');
    expect(out.join('\n')).toContain('出码前检查（4 项）');
    expect(out.join('\n')).toContain('package.json=1.0.14');
  });

  it('通过时打「四项检查通过」，且不打失败头', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root });
    const out: string[] = [];
    const err: string[] = [];

    preflight.printReport(r, { log: (s: unknown) => out.push(String(s)), error: (s: unknown) => err.push(String(s)) });

    expect(out.join('\n')).toContain('四项检查通过');
    expect(err).toEqual([]);
  });

  it('parsePreflightArgs：--root / --expect-sha / --expect-version 两种写法', () => {
    expect(preflight.parsePreflightArgs(['--root', '/a', '--expect-sha', '47f74ba8'])).toEqual({
      _: [],
      root: '/a',
      expectSha: '47f74ba8',
    });
    expect(preflight.parsePreflightArgs(['--expect-sha=47f74ba8', '--expect-version=1.0.18'])).toEqual({
      _: [],
      expectSha: '47f74ba8',
      expectVersion: '1.0.18',
    });
  });
});

// ---------- ⑥ publish.js 接线（参数解析层） ----------

describe('publish.js 接线：--skip-preflight / --expect-sha 可解析且不污染既有字段', () => {
  // 只 require 不执行：publish.js 入口有 require.main === module 保护。
  const publish = require('../scripts/publish') as {
    parseArgs: (argv: string[]) => Record<string, unknown>;
  };

  it('--skip-preflight → skipPreflight: true', () => {
    expect(publish.parseArgs(['--skip-preflight'])).toEqual({ _: [], skipPreflight: true });
  });

  it('--expect-sha 两种写法都能进 expectSha', () => {
    expect(publish.parseArgs(['--expect-sha', '47f74ba8'])).toEqual({ _: [], expectSha: '47f74ba8' });
    expect(publish.parseArgs(['--expect-sha=47f74ba8'])).toEqual({ _: [], expectSha: '47f74ba8' });
  });

  it('与既有 flag 共存不互相覆盖', () => {
    expect(publish.parseArgs(['--mode', 'cli', '--no-push', '--skip-preflight'])).toEqual({
      _: [],
      mode: 'cli',
      noPush: true,
      skipPreflight: true,
    });
  });
});

// ---------- ⑥b 门禁顺序：preflight 失败时「一次 CLI 都不许调」 ----------

describe('publish.js 门禁顺序（preview / upload 第一步就是 preflightGate）', () => {
  const publishMod = require('../scripts/publish') as { main: (argv: string[]) => void };
  const cp = require('child_process') as { execFileSync: (...a: unknown[]) => unknown };

  const fakeFailResult: PreflightResult = {
    ok: false,
    failures: [{ code: 'P2', title: '包根存在密钥文件：private.key', detail: '/x/private.key（1679 B）' }],
    info: {
      root: '/x',
      pkgVersion: '1.0.14',
      appVersion: '',
      versionTsExists: false,
      expectVersion: '1.0.14',
      branch: 'devtools/dachengzi-preview',
      headSha: '4292aa45',
      gitOk: true,
      expectSha: '',
      projectName: 'web_system-dachengzi',
      dirAllowed: false,
      rootKeyHits: [],
      deepKeyHits: [],
      warnings: [],
    },
  };

  let exitSpy: jest.SpyInstance;
  let execSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    execSpy = jest.spyOn(cp, 'execFileSync');
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('preview：preflight 失败 → exit(1)，且 execFileSync 零调用（没摸任何 CLI）', () => {
    jest.spyOn(preflight, 'runPreflight').mockReturnValue(fakeFailResult);

    expect(() => publishMod.main(['preview', '--no-push'])).toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(execSpy).not.toHaveBeenCalled();
    expect(errSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('private.key');
  });

  it('upload：同上，preflight 失败 → exit(1)，一次上传动作都没发生', () => {
    jest.spyOn(preflight, 'runPreflight').mockReturnValue(fakeFailResult);

    expect(() => publishMod.main(['upload', '--notify'])).toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(execSpy).not.toHaveBeenCalled();
  });

  it('preflight 通过时门禁不误伤：preview 继续走到 CLI 层', () => {
    jest.spyOn(preflight, 'runPreflight').mockReturnValue({ ...fakeFailResult, ok: true, failures: [] });

    expect(() => publishMod.main(['preview', '--no-push'])).toThrow('exit:1'); // 死在 CLI 层（未 mock）

    expect(execSpy).toHaveBeenCalled();
  });

  it('--skip-preflight：不跑 preflight，打印「已跳过出码前检查，风险自负」后继续', () => {
    const pfSpy = jest.spyOn(preflight, 'runPreflight');
    execSpy.mockImplementation(() => {
      throw new Error('CLI_REACHED');
    });

    expect(() => publishMod.main(['preview', '--no-push', '--skip-preflight'])).toThrow('exit:1');

    expect(pfSpy).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      '已跳过出码前检查，风险自负',
    );
    // 走到了 CLI 层才失败（说明确实「跳过门禁继续出码」而不是静默什么都不做）
    expect(execSpy).toHaveBeenCalled();
  });
});

// ---------- ⑦ 真实炸弹：只读实测 1.0.14 + 真私钥目录 ----------

const DANGER_ROOT = '/Users/geekwen/workspace/web_system-dachengzi/apps/dachengzi-minigram';
const dangerAvailable = fs.existsSync(path.join(DANGER_ROOT, 'private.key'));

const sha256 = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

describe('真实炸弹实测：1.0.14 + 真 private.key 的 web_system-dachengzi 必须被拒', () => {
  const dangerIt = dangerAvailable ? it : it.skip;

  dangerIt('对真实目录跑 preflight → 拒绝（P1 version.ts 缺失 + P2 包根私钥）', () => {
    const r = preflight.runPreflight({ root: DANGER_ROOT });

    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('P1');
    expect(codes(r)).toContain('P2');
    // 版本：真实读到的是 1.0.14，不是 1.0.18
    expect(r.info.pkgVersion).toBe('1.0.14');
    expect(r.info.versionTsExists).toBe(false);
    // 私钥：真文件、1679 B
    const key = r.info.rootKeyHits.find((h) => h.name === 'private.key');
    expect(key).toBeDefined();
    expect(key!.size).toBe(1679);
    // 工作区身份：分支直译「大橙子预览」，最容易骗人
    expect(r.info.branch).toBe('devtools/dachengzi-preview');
    expect(r.info.headSha).toBe('4292aa45');
    // 目录不在白名单
    expect(r.info.dirAllowed).toBe(false);
  });

  dangerIt('实测过程只读：跑前跑后 private.key 的 sha256/大小/mtime、package.json、包根清单全不变', () => {
    const keyPath = path.join(DANGER_ROOT, 'private.key');
    const pkgPath = path.join(DANGER_ROOT, 'package.json');

    const before = {
      keyHash: sha256(keyPath),
      keyStat: fs.statSync(keyPath).mtimeMs,
      keySize: fs.statSync(keyPath).size,
      pkg: fs.readFileSync(pkgPath, 'utf-8'),
      list: fs.readdirSync(DANGER_ROOT).sort(),
    };

    preflight.runPreflight({ root: DANGER_ROOT });

    const after = {
      keyHash: sha256(keyPath),
      keyStat: fs.statSync(keyPath).mtimeMs,
      keySize: fs.statSync(keyPath).size,
      pkg: fs.readFileSync(pkgPath, 'utf-8'),
      list: fs.readdirSync(DANGER_ROOT).sort(),
    };

    expect(after).toEqual(before);
  });

  dangerIt('报告里绝不出现私钥内容（只报文件名/大小/时间）', () => {
    const r = preflight.runPreflight({ root: DANGER_ROOT });
    const out: string[] = [];
    const err: string[] = [];
    preflight.printReport(r, { log: (s: unknown) => out.push(String(s)), error: (s: unknown) => err.push(String(s)) });

    const all = [...out, ...err].join('\n');
    const keyBody = fs.readFileSync(path.join(DANGER_ROOT, 'private.key'), 'utf-8');
    const firstLine = keyBody.split('\n')[0].trim();
    expect(all).toContain('private.key');
    if (firstLine) expect(all).not.toContain(firstLine);
    expect(all).not.toContain('PRIVATE KEY-----\n');
  });
});
