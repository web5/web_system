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

interface CliCandidate {
  path: string;
  source: string;
  note?: string;
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
  requiredDir: string;
  allowAnyDir: boolean;
  mode: string;
  rootKeyHits: Hit[];
  deepKeyHits: Hit[];
  packIgnoreCoversKeys: boolean;
  dirty: { total: number; shipping: string[]; excluded: string[] };
  cli: {
    ok: boolean;
    path: string;
    source: string;
    skipped: boolean;
    /** 环境变量是否显式指定了（显式 = 唯一候选，不会回落默认路径） */
    configured: boolean;
    /** 实际检查过的候选清单（失败时用它列「到底找过哪儿」） */
    checked: CliCandidate[];
  };
  warnings: string[];
}

interface PreflightResult {
  ok: boolean;
  failures: Failure[];
  info: PreflightInfo;
}

interface PreflightOpts {
  root?: string;
  mode?: 'cli' | 'ci';
  expectVersion?: string;
  expectSha?: string;
  requireDir?: string;
  allowDirty?: boolean;
  allowAnyDir?: boolean;
  forUpload?: boolean;
  execFileSync?: (...args: unknown[]) => unknown;
  env?: Record<string, string | undefined>;
  /** P6 官方默认安装路径的注入点：不注入就落到本机真实路径，测试会随「本机装没装工具」飘 */
  defaultCliPaths?: string[];
}

interface PreflightModule {
  runPreflight: (opts?: PreflightOpts) => PreflightResult;
  /** 门禁的唯一执行入口（跑 → 打印 → 不通过 exit 1），台账 9122 */
  runGateOrExit: (
    opts?: PreflightOpts & { skipPreflight?: boolean },
    sub?: 'preview' | 'upload',
    ctx?: {
      env?: Record<string, string | undefined>;
      log?: (...a: unknown[]) => void;
      warn?: (...a: unknown[]) => void;
      exit?: (code: number) => void;
    },
  ) => PreflightResult;
  withGateState: (
    env: Record<string, string | undefined>,
    state?: string,
  ) => Record<string, string | undefined>;
  GATE_ENV: string;
  GATE_DONE: string;
  GATE_SKIP: string;
  printReport: (
    result: PreflightResult,
    io?: { log?: (...a: unknown[]) => void; error?: (...a: unknown[]) => void },
  ) => void;
  parsePreflightArgs: (argv: string[]) => {
    _: string[];
    root?: string;
    expectSha?: string;
    expectVersion?: string;
    allowAnyDir?: boolean;
  };
  isSameSha: (a: string, b: string) => boolean;
  isKeyFile: (name: string) => boolean;
  ignoreCoversKeys: (ignores: unknown[], fileName?: string) => boolean;
  dirtyEntryShipsPackage: (entry: string, ignores: unknown[], pkgPrefix?: string) => boolean;
  checkDevtoolsCli: (
    execFileSync: (...a: unknown[]) => unknown,
    env: Record<string, string | undefined>,
    opts?: { defaultCliPaths?: string[] },
  ) => {
    ok: boolean;
    path: string;
    source: string;
    configured: boolean;
    checked: CliCandidate[];
  };
  DEFAULT_CLI_PATHS: string[];
  ALLOWED_DIR_NAME: RegExp;
}

// ---------- 夹具 ----------

const tmpDirs: string[] = [];

/**
 * 造一个「小程序包根」临时目录。opts 控制脏数据形态。
 *
 * 🔴 包根一律落在**白名单形态的顶层目录**下（默认 `web_system-1018-r2`）：
 *    P4 自 2026-11-26 起默认硬拦「顶层名不在 web_system-<任务号> 内」，
 *    若夹具直接用 `mkdtemp` 出来的 `preflight-xxxx` 当顶层名，则本文件里
 *    所有与目录无关的用例（P1/P2/P3/P5/P6）都会被 P4 连带打红 ——
 *    那是假红，会掩盖真正要断言的那一项。要测「目录名不对」请显式传 dirName。
 */
function mkFixture(opts: {
  version?: string;
  appVersion?: string;
  versionTs?: 'present' | 'absent';
  rawVersionTs?: string;
  keys?: string[];
  extraFiles?: string[];
  packIgnores?: unknown[];
  projectConfig?: boolean;
  /** true 时按真实仓库布局造：<tmp>/<dirName>/apps/dachengzi-minigram */
  repoLayout?: boolean;
  /** worktree 顶层目录名（P4 判的就是它），默认 web_system-1018-r2 */
  dirName?: string;
}): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
  tmpDirs.push(base);
  const top = path.join(base, opts.dirName ?? 'web_system-1018-r2');
  const dir = opts.repoLayout ? path.join(top, 'apps', 'dachengzi-minigram') : top;
  fs.mkdirSync(dir, { recursive: true });

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

  if (opts.packIgnores || opts.projectConfig) {
    fs.writeFileSync(
      path.join(dir, 'project.config.json'),
      JSON.stringify({ appid: 'wxfixture', packOptions: { ignore: opts.packIgnores ?? [] } }, null, 2),
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

/**
 * 假 git：返回固定的分支/sha/toplevel/status，用来测 P3/P4/P5（真 git 在临时目录里读不到）。
 * 顺序有讲究：`status --short` 里也含 `--short`，必须先判 status。
 */
function fakeGit(branch: string, sha: string, toplevel: string, status = '') {
  return (_cmd: unknown, args: unknown): string => {
    const a = (args as string[]).join(' ');
    if (a.includes('status')) return status ? `${status}\n` : '';
    if (a.includes('--abbrev-ref')) return `${branch}\n`;
    if (a.includes('--show-toplevel')) return `${toplevel}\n`;
    if (a.includes('--short')) return `${sha}\n`;
    throw new Error(`unexpected git args: ${a}`);
  };
}

const codes = (r: PreflightResult) => r.failures.map((f) => f.code);

// P6 会读 WECHAT_DEVTOOLS_CLI 判断「CLI 是否可执行」。测试里指向 node 自身（真实存在且可执行），
// 这样本机没装微信开发者工具也不会让无关用例随机红；P6 的失败路径单独用 env:{} 显式构造。
const realCliEnv = process.env.WECHAT_DEVTOOLS_CLI;
beforeAll(() => {
  process.env.WECHAT_DEVTOOLS_CLI = process.execPath;
});
afterAll(() => {
  if (realCliEnv === undefined) delete process.env.WECHAT_DEVTOOLS_CLI;
  else process.env.WECHAT_DEVTOOLS_CLI = realCliEnv;
});

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

// ---------- ④ P4 目录白名单（默认硬拦 + 唯一逃生口） ----------

describe('P4 目录白名单（默认硬拦，--allow-any-dir 是唯一逃生口）', () => {
  // 用 fakeGit 把 toplevel 钉到具体目录名 —— P4 判的是 worktree 顶层名，
  // 夹具真实路径（<tmp>/web_system-1018-r2）在带 fakeGit 时并不参与判定。
  const atDir = (name: string, branch = 'feat/some-branch', sha = 'abc1234') =>
    fakeGit(branch, sha, `/Users/x/workspace/${name}`);

  it('web_system-1018-r2 这类发布 worktree → 通过且无 P4 痕迹', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      execFileSync: atDir('web_system-1018-r2', 'release/dachengzi-1018-r2', '47f74ba8'),
    });

    expect(r.info.projectName).toBe('web_system-1018-r2');
    expect(r.info.dirAllowed).toBe(true);
    expect(r.info.warnings.join('\n')).not.toContain('P4');
  });

  // 🔴 本条是 H3 的核心：无 --require-dir + 目录不在白名单 → **必须**失败。
  //    改回「只警告」时这条会红（变异反证就靠它）。
  it('无 --require-dir + 目录不在白名单（web_system-pkgkey）→ 失败，报告里是 P4', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root, execFileSync: atDir('web_system-pkgkey') });

    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(['P4']);
    const f = r.failures.find((x) => x.code === 'P4')!;
    expect(f.title).toContain('web_system-pkgkey');
    // 三行结构：现象（哪个目录名）/ 判据（白名单长什么样）/ 怎么办（可执行的下一步）
    expect(f.title).toContain('不在出码白名单');
    expect(f.detail).toContain('web_system-1018');
    expect(f.hint).toContain('--require-dir');
    expect(f.hint).toContain('--allow-any-dir');
  });

  it('危险目录 web_system-dachengzi（1.0.14 事故目录的命名形态）→ 失败，不再只是警告', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      execFileSync: atDir('web_system-dachengzi', 'devtools/dachengzi-preview', '4292aa45'),
    });

    expect(r.ok).toBe(false);
    expect(r.info.dirAllowed).toBe(false);
    expect(r.failures.find((x) => x.code === 'P4')!.title).toContain('web_system-dachengzi');
  });

  it('同上 + allowAnyDir: true → 通过，且必须打显式告警行（不许静默降级）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      allowAnyDir: true,
      execFileSync: atDir('web_system-pkgkey'),
    });

    expect(r.ok).toBe(true);
    expect(codes(r)).not.toContain('P4');
    expect(r.info.allowAnyDir).toBe(true);
    // 告警行要能被人一眼看到：点名开关 + 点名目录 + 说明风险仍成立
    const w = r.info.warnings.join('\n');
    expect(w).toContain('--allow-any-dir');
    expect(w).toContain('web_system-pkgkey');
    expect(w).toContain('风险');
  });

  it('allowAnyDir 但目录本来就在白名单内 → 通过，且如实说明该开关本次未生效', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      allowAnyDir: true,
      execFileSync: atDir('web_system-1018-r2'),
    });

    expect(r.ok).toBe(true);
    expect(r.info.warnings.join('\n')).toContain('本次未生效');
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
    expect(out.join('\n')).toContain('出码前检查（P1–P6');
    expect(out.join('\n')).toContain('package.json=1.0.14');
  });

  it('通过时打「六项检查通过」，且不打失败头', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root });
    const out: string[] = [];
    const err: string[] = [];

    preflight.printReport(r, { log: (s: unknown) => out.push(String(s)), error: (s: unknown) => err.push(String(s)) });

    expect(out.join('\n')).toContain('六项检查通过');
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
    preflightGate: (opts: Record<string, unknown>, sub: 'preview' | 'upload') => void;
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

  it('--allow-any-dir → allowAnyDir: true，且与 --skip-preflight 是两个独立开关', () => {
    expect(publish.parseArgs(['--allow-any-dir'])).toEqual({ _: [], allowAnyDir: true });
    // 关键：allowAnyDir 不许被实现成「等同 skip」——只放开 P4，其余各项照旧跑
    expect(publish.parseArgs(['--allow-any-dir', '--skip-preflight'])).toEqual({
      _: [],
      allowAnyDir: true,
      skipPreflight: true,
    });
  });

  it('preflightGate 把 allowAnyDir 透传进唯一编排 runGateOrExit（preview）', () => {
    // 本文件不 jest.mock preflight（要测它的真判定逻辑），故这里用 spy 只观察调用参数。
    // 🔴 台账 9122 后 publish.js 只调 preflight.runGateOrExit（跑/打印/退出都在那里一份），
    //    不再自己调 runPreflight —— 所以 spy 的接缝是 runGateOrExit。
    const spy = jest.spyOn(preflight, 'runGateOrExit').mockReturnValue({
      ok: true,
      failures: [],
      info: {} as PreflightInfo,
    });
    try {
      publish.preflightGate({ allowAnyDir: true }, 'preview');
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ allowAnyDir: true }), 'preview');
      // 未声明时不伪造 true（否则「默认放开」= 门禁白写）
      publish.preflightGate({}, 'preview');
      const arg = spy.mock.calls[1][0] as { allowAnyDir?: unknown };
      expect(arg.allowAnyDir).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------- ⑥b 门禁顺序：门禁失败时「一次出码动作都不许调」 ----------

describe('publish.js 门禁顺序（preview / upload 第一步就是 preflightGate）', () => {
  const publishMod = require('../scripts/publish') as { main: (argv: string[]) => void };
  const cp = require('child_process') as { execFileSync: (...a: unknown[]) => unknown };

  let exitSpy: jest.SpyInstance;
  let execSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  const OLD_CLI_ENV = process.env.WECHAT_DEVTOOLS_CLI;

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
    if (OLD_CLI_ENV === undefined) delete process.env.WECHAT_DEVTOOLS_CLI;
    else process.env.WECHAT_DEVTOOLS_CLI = OLD_CLI_ENV;
    jest.restoreAllMocks();
  });

  /**
   * 「出码动作」的调用记录。
   *
   * 🔴 台账 9122 后门禁跑在入口**内部**，它自己要用 `git rev-parse` / `git status` /
   *    `which cli` 三个只读探针 —— 所以这里断言的是「一次出码动作都没发生」，
   *    而不是「execFileSync 零调用」（后者在旧结构下成立，因为门禁在另一个模块里被 mock 掉了，
   *    那其实是一条**假强**的断言：它证明的是「mock 生效」，不是「没摸 CLI」）。
   */
  const outputCmds = (): string[] => execSpy.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((cmd: string) => cmd !== 'git' && cmd !== 'which');

  it('preview：门禁失败（--expect-version 不可能满足）→ exit(1)，一次出码动作都没发生', () => {
    expect(() => publishMod.main(['preview', '--no-push', '--expect-version', '9.9.9']))
      .toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(outputCmds()).toEqual([]);
    // 拦住它的是 P1 判据本身（而不是什么别的错）
    expect(errSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'package.json 版本 ≠ 期望版本',
    );
  });

  it('upload：同上，门禁失败 → exit(1)，一次上传动作都没发生', () => {
    expect(() => publishMod.main(['upload', '--notify', '--expect-version', '9.9.9']))
      .toThrow('exit:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(outputCmds()).toEqual([]);
  });

  it('门禁通过时门禁不误伤：preview 继续走到 CLI 层', () => {
    // 🔴 不许真出码：把 WECHAT_DEVTOOLS_CLI 指向一个「存在、可执行、但立刻 exit 1」的假 cli。
    //    P6 只查文件可执行位（不执行它），所以能过；真正 spawn 时它自己退 1 → cmdPreview 报错退出。
    const fakeCli = path.join(os.tmpdir(), `fake-devtools-cli-9122-${process.pid}.sh`);
    fs.writeFileSync(fakeCli, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(fakeCli, 0o755);
    process.env.WECHAT_DEVTOOLS_CLI = fakeCli;

    try {
      // --allow-any-dir：本 worktree 顶层名不在发布白名单内（CI 里可能本来就在，开关无害）
      expect(() => publishMod.main(['preview', '--no-push', '--allow-any-dir'])).toThrow('exit:1');

      // 门禁没拦住（拦住了 outputCmds 会是空的）→ 真的走到了 cli 调用才失败
      expect(outputCmds()).toContain(fakeCli);
      expect(errSpy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('cli 出码失败');
    } finally {
      fs.rmSync(fakeCli, { force: true });
      // cmdPreview 在调 cli 前会 mkdir .ci-output；清掉空目录，别给工作区留垃圾
      fs.rmSync(path.join(__dirname, '..', '.ci-output'), { recursive: true, force: true });
    }
  });

  it('--skip-preflight：不跑门禁判定，打印「已跳过出码前检查，风险自负」后继续', () => {
    const gateSpy = jest.spyOn(preflight, 'runGateOrExit');
    execSpy.mockImplementation(() => {
      throw new Error('CLI_REACHED');
    });

    expect(() => publishMod.main(['preview', '--no-push', '--skip-preflight'])).toThrow('exit:1');

    // 编排入口仍被调（跳过与否由它一处决定），但它没判定 → 报表一行都没有
    expect(gateSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('出码前检查（P1–P6');
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

// ---------- ⑧ P2 按出码模式分层（ci 模式私钥是必需文件） ----------

describe('P2 出码模式分层：cli 禁私钥，ci 靠 packOptions.ignore 兜底', () => {
  it('cli 模式（默认）+ 包根 private.key → 失败（cli 根本不需要私钥）', () => {
    const root = mkFixture({ version: '1.0.18', keys: ['private.key'] });
    const r = preflight.runPreflight({ root });

    expect(codes(r)).toContain('P2');
    expect(r.failures.find((f) => f.code === 'P2')!.hint).toContain('cli 模式出码不需要私钥');
  });

  it('ci 模式 + 包根 private.key + ignore 覆盖 → 不阻断，但打 HIGH 警告（含「必需文件」和根治办法）', () => {
    const root = mkFixture({
      version: '1.0.18',
      keys: ['private.key'],
      packIgnores: [{ type: 'file', value: 'private.key' }],
    });
    const r = preflight.runPreflight({ root, mode: 'ci' });

    expect(r.ok).toBe(true);
    expect(r.info.packIgnoreCoversKeys).toBe(true);
    const w = r.info.warnings.join('\n');
    expect(w).toContain('ci 模式的必需文件');
    expect(w).toContain('MINIPROGRAM_PRIVATE_KEY_PATH');
  });

  it('ci 模式 + 包根 private.key + ignore **没**覆盖 → 失败（这才是真会随包外发）', () => {
    const root = mkFixture({
      version: '1.0.18',
      keys: ['private.key'],
      // 只忽略 project.private.config.json，故意不含任何 key 规则
      packIgnores: [{ type: 'file', value: 'project.private.config.json' }],
    });
    const r = preflight.runPreflight({ root, mode: 'ci' });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.code === 'P2');
    expect(f!.title).toContain('未被 packOptions.ignore 覆盖');
    expect(f!.hint).toContain('{"type":"file","value":"private.key"}');
  });

  it('ci 模式 + 一条 suffix .key 规则也能兜住（不强制写成 file 规则）', () => {
    const root = mkFixture({
      version: '1.0.18',
      keys: ['private.key'],
      packIgnores: [{ type: 'suffix', value: '.key' }],
    });
    const r = preflight.runPreflight({ root, mode: 'ci' });

    expect(r.ok).toBe(true);
    expect(r.info.packIgnoreCoversKeys).toBe(true);
  });

  it('ci 模式 + 没有 project.config.json（读不到 ignore）→ 失败（不能「读不到就当有」）', () => {
    const root = mkFixture({ version: '1.0.18', keys: ['private.key'] });
    const r = preflight.runPreflight({ root, mode: 'ci' });

    expect(r.ok).toBe(false);
    expect(r.info.packIgnoreCoversKeys).toBe(false);
  });
});

// ---------- ⑨ 私钥识别口径（别把合法配置文件判成密钥） ----------

describe('私钥识别口径：只认 *.key / *.pem，不误伤 project.private.config.json', () => {
  it('project.private.config.json 不算密钥（用 /key|private/i 会假阳性）', () => {
    expect(preflight.isKeyFile('project.private.config.json')).toBe(false);
    const root = mkFixture({ version: '1.0.18', extraFiles: ['project.private.config.json'] });
    const r = preflight.runPreflight({ root });
    expect(r.info.rootKeyHits).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('ignoreCoversKeys：file/suffix/glob 三种合法写法都算覆盖，folder 不算', () => {
    expect(preflight.ignoreCoversKeys([{ type: 'file', value: 'private.key' }])).toBe(true);
    expect(preflight.ignoreCoversKeys([{ type: 'suffix', value: '.pem' }])).toBe(true);
    expect(preflight.ignoreCoversKeys([{ type: 'glob', value: '**/*.key' }])).toBe(true);
    expect(preflight.ignoreCoversKeys([{ type: 'folder', value: 'scripts' }])).toBe(false);
    expect(preflight.ignoreCoversKeys([])).toBe(false);
  });
});

// ---------- ⑩ P5 工作区干净 ----------

describe('P5 工作区干净：只拦「会进包的」未提交改动', () => {
  const dirtyPage = ' M apps/dachengzi-minigram/pages/home/index/index.ts';

  const topOf = (root: string) => path.dirname(path.dirname(root)); // <tmp>/web_system-1018-r2

  it('会进包的改动（页面代码）→ 失败，并列出条目', () => {
    const root = mkFixture({ version: '1.0.18', projectConfig: true, repoLayout: true });
    const r = preflight.runPreflight({
      root,
      execFileSync: fakeGit('main', 'abc1234', topOf(root), dirtyPage),
    });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.code === 'P5');
    expect(f!.detail).toContain('pages/home/index/index.ts');
    expect(r.info.dirty.shipping).toEqual([dirtyPage]);
  });

  it('只在 scripts/ 的改动（不进包）→ 只警告，不阻断', () => {
    const root = mkFixture({ version: '1.0.18', projectConfig: true, repoLayout: true });
    const r = preflight.runPreflight({
      root,
      execFileSync: fakeGit(
        'main',
        'abc1234',
        topOf(root),
        ' M apps/dachengzi-minigram/scripts/publish.js',
      ),
    });

    expect(r.ok).toBe(true);
    expect(r.info.dirty.total).toBe(1);
    expect(r.info.dirty.shipping).toEqual([]);
    expect(r.info.warnings.join('\n')).toContain('都不在打包范围内');
  });

  it('--allow-dirty 显式放行 → 通过，但必须打警告', () => {
    const root = mkFixture({ version: '1.0.18', projectConfig: true, repoLayout: true });
    const r = preflight.runPreflight({
      root,
      allowDirty: true,
      execFileSync: fakeGit('main', 'abc1234', topOf(root), dirtyPage),
    });

    expect(r.ok).toBe(true);
    expect(r.info.warnings.join('\n')).toContain('--allow-dirty 放行');
  });

  it('dirtyEntryShipsPackage：命中 packOptions.ignore 的 folder 规则 → 不进包', () => {
    const ignores = [{ type: 'folder', value: 'assets/dev' }];
    expect(preflight.dirtyEntryShipsPackage(' M assets/dev/foo.ts', ignores)).toBe(false);
    expect(preflight.dirtyEntryShipsPackage(' M assets/prod/foo.ts', ignores)).toBe(true);
    // 带包前缀时先换算：app 包内的 pages/* 会进包，包外（其他包）不影响本包
    const prefix = 'apps/dachengzi-minigram/';
    expect(preflight.dirtyEntryShipsPackage(' M apps/dachengzi-minigram/pages/a.ts', ignores, prefix)).toBe(true);
    expect(preflight.dirtyEntryShipsPackage(' M apps/kedou-ai-minigram/pages/a.ts', ignores, prefix)).toBe(false);
  });
});

// ---------- ⑪ P6 开发者工具 CLI 可执行 ----------

describe('P6 微信开发者工具 CLI 可执行（发布全程唯一的硬缺口）', () => {
  /**
   * 造一个「可执行的假 cli」，并把它的绝对路径当作 P6 的官方默认安装路径注入。
   *
   * 🔴 为什么必须注入：默认路径是**本机真实路径**。本机装了开发者工具 → 默认路径存在；
   *    CI 上没装 → 不存在。直接依赖本机路径会让同一条用例在两边得出相反结论。
   */
  function mkFakeDefaultCli(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-cli-'));
    tmpDirs.push(dir);
    const p = path.join(dir, 'wechatwebdevtools.app', 'Contents', 'MacOS', 'cli');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(p, 0o755);
    return p;
  }

  /** 一个「默认路径不存在」的注入值：证明不靠本机安装也能走到失败分支。 */
  const NO_DEFAULT_CLI = '/nonexistent/wechatwebdevtools.app/Contents/MacOS/cli';

  it('WECHAT_DEVTOOLS_CLI 未设且 which cli 也找不到 → 失败（不是等到 spawnSync ENOENT）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      env: {},
      defaultCliPaths: [NO_DEFAULT_CLI],
      execFileSync: (cmd: unknown, args: unknown) => {
        const a = (args as string[]).join(' ');
        if (String(cmd) === 'which') throw new Error('which: no cli in PATH');
        if (a.includes('status')) return '';
        if (a.includes('--abbrev-ref')) return 'main\n';
        if (a.includes('--show-toplevel')) return '/Users/x/workspace/web_system-1018-r2\n';
        if (a.includes('--short')) return '47f74ba8\n';
        throw new Error(`unexpected: ${String(cmd)} ${a}`);
      },
    });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.code === 'P6');
    expect(f!.detail).toContain('WECHAT_DEVTOOLS_CLI=(未设置)');
    expect(f!.hint).toContain('wechatwebdevtools.app');
  });

  it('WECHAT_DEVTOOLS_CLI 未设 + 官方默认路径可执行 → 回落通过，并打印「已回落默认安装路径」', () => {
    const root = mkFixture({ version: '1.0.18' });
    const fakeDefaultCli = mkFakeDefaultCli();
    const r = preflight.runPreflight({ root, env: {}, defaultCliPaths: [fakeDefaultCli] });

    expect(r.ok).toBe(true);
    expect(r.info.cli.ok).toBe(true);
    expect(r.info.cli.source).toBe('default');
    expect(r.info.cli.path).toBe(fakeDefaultCli);
    expect(r.info.cli.configured).toBe(false);
    // 回落的唯一可视证据：一行能被 grep 到的提示
    expect(r.info.warnings.join('\n')).toContain(`[P6] 已回落默认安装路径：${fakeDefaultCli}`);
    // 且真的打进了报告（不只是躺在 info 里）
    const out: string[] = [];
    preflight.printReport(r, { log: (s: unknown) => out.push(String(s)), error: () => undefined });
    expect(out.join('\n')).toContain(`[P6] 已回落默认安装路径：${fakeDefaultCli}`);
  });

  it('WECHAT_DEVTOOLS_CLI 显式设了 → 只认它，即使默认路径也存在也不回落', () => {
    const root = mkFixture({ version: '1.0.18' });
    const fakeDefaultCli = mkFakeDefaultCli();
    const r = preflight.runPreflight({
      root,
      env: { WECHAT_DEVTOOLS_CLI: process.execPath },
      defaultCliPaths: [fakeDefaultCli],
    });

    expect(r.ok).toBe(true);
    expect(r.info.cli.source).toBe('env');
    expect(r.info.cli.path).toBe(process.execPath);
    expect(r.info.cli.configured).toBe(true);
    const all = r.info.warnings.join('\n');
    expect(all).not.toContain('已回落');
    // 显式命中时压根不该去查默认路径（省一次 stat，也避免「到底用了哪个」的歧义）
    expect(r.info.cli.checked.map((c) => c.path)).toEqual([process.execPath]);
  });

  it('WECHAT_DEVTOOLS_CLI 设了但不可执行 → 失败，不因默认路径可用就偷偷改用默认路径', () => {
    const root = mkFixture({ version: '1.0.18' });
    const fakeDefaultCli = mkFakeDefaultCli();
    const r = preflight.runPreflight({
      root,
      env: { WECHAT_DEVTOOLS_CLI: '/nonexistent/cli' },
      defaultCliPaths: [fakeDefaultCli],
    });

    expect(r.ok).toBe(false);
    expect(r.info.cli.source).toBe('env');
    const f = r.failures.find((x) => x.code === 'P6')!;
    expect(f.detail).toContain('/nonexistent/cli');
    // 关键：没有偷偷换成默认路径 —— 「我指错了」必须是响亮的失败，不是静默的另一个答案
    expect(f.detail).not.toContain(fakeDefaultCli);
    expect(r.info.cli.checked.map((c) => c.path)).toEqual(['/nonexistent/cli']);
    expect(r.info.warnings.join('\n')).not.toContain('已回落');
  });

  it('三个候选（环境变量/默认路径/PATH）全不可用 → 失败，且报错列出检查过的每一个路径', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      env: {},
      defaultCliPaths: [NO_DEFAULT_CLI],
      execFileSync: (cmd: unknown, args: unknown) => {
        const a = (args as string[]).join(' ');
        if (String(cmd) === 'which') throw new Error('which: no cli in PATH');
        if (a.includes('status')) return '';
        if (a.includes('--abbrev-ref')) return 'main\n';
        if (a.includes('--show-toplevel')) return '/Users/x/workspace/web_system-1018-r2\n';
        if (a.includes('--short')) return '47f74ba8\n';
        throw new Error(`unexpected: ${String(cmd)} ${a}`);
      },
    });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.code === 'P6')!;
    expect(f.detail).toContain('检查过 2 个候选');
    expect(f.detail).toContain(NO_DEFAULT_CLI);
    expect(f.detail).toContain('官方默认安装路径');
    expect(f.detail).toContain('PATH 里的 cli');
    expect(f.hint).toContain('WECHAT_DEVTOOLS_CLI');
  });

  it('默认路径存在但是个目录 → 不算可用（目录也有 X_OK 位，只看 access 会假绿）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const dirAsCli = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-clidir-'));
    tmpDirs.push(dirAsCli);
    const r = preflight.runPreflight({ root, env: {}, defaultCliPaths: [dirAsCli] });

    expect(r.ok).toBe(false);
    expect(r.info.cli.ok).toBe(false);
    expect(r.failures.find((x) => x.code === 'P6')!.detail).toContain(dirAsCli);
  });

  it('WECHAT_DEVTOOLS_CLI 指向不存在的路径 → 失败', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root, env: { WECHAT_DEVTOOLS_CLI: '/nonexistent/cli' } });

    expect(r.ok).toBe(false);
    expect(r.failures.find((x) => x.code === 'P6')!.detail).toContain('/nonexistent/cli');
  });

  it('WECHAT_DEVTOOLS_CLI 可执行 → 通过并报出实际路径', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root, env: { WECHAT_DEVTOOLS_CLI: process.execPath } });

    expect(r.ok).toBe(true);
    expect(r.info.cli.ok).toBe(true);
    expect(r.info.cli.path).toBe(process.execPath);
    expect(r.info.cli.source).toBe('env');
    expect(r.info.warnings.join('\n')).toContain('开发者工具 CLI 可执行');
    expect(r.info.warnings.join('\n')).not.toContain('已回落');
  });

  it('ci 模式不需要开发者工具 CLI → P6 跳过（不会因没装工具而误杀 ci）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root, mode: 'ci', env: {} });

    expect(r.info.cli.skipped).toBe(true);
    expect(r.failures.some((f) => f.code === 'P6')).toBe(false);
  });
});

// ---------- ⑫ P3 多候选 sha / P4 硬拦目录 / upload 人工确认提示 ----------

describe('P3 多候选 sha', () => {
  it('--expect-sha 传逗号分隔的多个候选，命中任一即通过', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      expectSha: '019d282b, 47f74ba8',
      execFileSync: fakeGit('release/dachengzi-1018-r2', '47f74ba8', '/Users/x/workspace/web_system-1018-r2'),
    });

    expect(r.ok).toBe(true);
    expect(r.info.warnings.join('\n')).toContain('核对通过');
  });

  it('三个候选都不匹配 → 失败，detail 列出全部候选', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      expectSha: '019d282b,47f74ba8',
      execFileSync: fakeGit('devtools/dachengzi-preview', '4292aa45', '/Users/x/workspace/web_system-dachengzi'),
    });

    expect(r.ok).toBe(false);
    expect(r.failures.find((f) => f.code === 'P3')!.detail).toContain('019d282b|47f74ba8');
  });
});

describe('P4 --require-dir 可把目录白名单升级为硬拦', () => {
  it('不匹配 --require-dir → 失败（发布轮次只许在指定 worktree 出码）', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      requireDir: '^web_system-1018(-r2)?$',
      execFileSync: fakeGit('feat/some-branch', 'abc1234', '/Users/x/workspace/web_system-hero9042'),
    });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.code === 'P4');
    expect(f!.title).toContain('web_system-hero9042');
    expect(f!.detail).toContain('^web_system-1018(-r2)?$');
  });

  it('匹配 --require-dir → 通过', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({
      root,
      requireDir: '^web_system-1018(-r2)?$',
      execFileSync: fakeGit('release/dachengzi-1018-r2', '47f74ba8', '/Users/x/workspace/web_system-1018-r2'),
    });

    expect(r.ok).toBe(true);
    expect(r.info.requiredDir).toBe('^web_system-1018(-r2)?$');
  });
});

describe('upload 的「后台是否已有同版本」只做提醒，不假装检查过', () => {
  it('forUpload → 打「微信无只读接口，请人工确认」的提醒', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root, forUpload: true });

    const w = r.info.warnings.join('\n');
    expect(w).toContain('微信无只读接口');
    expect(w).toContain('开发版本列表');
    // 提醒不影响通过（它不是断言，因为脚本根本查不到）
    expect(r.ok).toBe(true);
  });

  it('preview（非 upload）不打这条提醒', () => {
    const root = mkFixture({ version: '1.0.18' });
    const r = preflight.runPreflight({ root });

    expect(r.info.warnings.join('\n')).not.toContain('微信无只读接口');
  });
});
