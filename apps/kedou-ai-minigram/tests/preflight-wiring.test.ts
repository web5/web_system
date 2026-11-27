/// <reference types="node" />
/**
 * 门禁「接线」测试（科豆侧）—— 台账 9136
 *
 * 🔴 为什么科豆需要这份文件：接门禁之前，`apps/kedou-ai-minigram/scripts/preview.js` /
 *    `upload.js` **直连即出码**，P1–P6 一项都不跑（`grep -c preflight scripts/*.js` 曾是 0），
 *    也没有 publish.js 那层外壳 —— 和大橙子 9122 修好之前的等价状态，只是连外壳都没有。
 *    判据是共享的，而「谁在什么时候调判据」散在调用方，于是「门禁写着、路却绕得过」。
 *
 * 🔴 本文件**不测判据逻辑**（共享层那边由大橙子的 tests/preflight.test.ts 覆盖），
 *    只钉四件接线事实：
 *
 *   W1 · 谁驱动 miniprogram-ci 出码，谁就必须**自己先过门禁**：
 *        出码载体里 `runGateOrExit(` 的位置必须早于 `new Project(`。
 *        判据用源码下标比较，不是「含有就行」—— 顺序反了等于先动手再检查。
 *   W2 · npm 入口指向的就是那两个载体（`preview` → scripts/preview.js、
 *        `upload` → scripts/upload.js）：入口与载体一旦分叉，就会出现「从这条入口进不设防」。
 *   W3 · **一份实现**：判据只存在于仓库根共享层 `scripts/lib/miniprogram-preflight.js`，
 *        大橙子与科豆都 require 它；任一 app 目录下出现第二份判据实现即红。
 *   W4 · 门禁查的根 == 出码的根：两个载体都必须 `delete gateOpts.root` 再用本包根，
 *        且 mode 固定 ci（走 miniprogram-ci，不判开发者工具 CLI）。
 *   W5 · 行为面：真跑一次子进程，用**必然不满足**的 --expect-version 证明它真的拦得住，
 *        且零产物（`.ci-output` 跑前跑后文件数一致）。
 *   W6 · P3 `--expect-sha` 的正/负向行为（**本文件唯一的判据行为面**，见下）。
 *
 * 🔴 为什么破例加 W6（2026-11-27 共享层收敛时发现的真缺口）：
 *    `readGitIdentity` / `isSameSha` 收敛成 `scripts/lib/git-identity.js` 单一实现后，
 *    一处坏掉两个 app 都受影响 —— 但当时只有大橙子那边有「expect-sha 比对成功」的用例。
 *    实测：把共享层 `isSameSha` 改成 `return false`，大橙子 preflight 测试红 3 例，
 *    科豆 **19 例全绿、一例都没红** —— 也就是说 `isSameSha` 对科豆完全无网。
 *    本文件此前只钉「接线」（谁在什么时候调判据），不钉判据本身，所以这条缺口自然漏掉。
 *    W6 只补 P3 这一个方向，不把大橙子的判据测试整套搬过来（那会变成第二份维护面）。
 *
 * 🔴 「不许真出码」的写法：W5 一律带 `--expect-version 9.9.9`（本包版本是 1.0.13，
 *    这条永远不可能通过），并注入 `MINIPROGRAM_CI_PATH=<不存在的目录>` 作第二道保险 ——
 *    万一门禁被谁改坏放行了，下一句 require(miniprogram-ci) 也会立刻炸掉，
 *    走不到网络请求、走不到写二维码、走不到上传开发版。
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.setTimeout(120000);

const APP_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(APP_ROOT, '..', '..');
const SCRIPTS_DIR = path.join(APP_ROOT, 'scripts');
/** 共享层：唯一实现（台账 9136 从大橙子迁到仓库根，两个 app 共用） */
const SHARED_REL = path.join('scripts', 'lib', 'miniprogram-preflight.js');
const SHARED_ABS = path.join(REPO_ROOT, SHARED_REL);
const DACHENGZI_SCRIPTS = path.join(REPO_ROOT, 'apps', 'dachengzi-minigram', 'scripts');

/** 必然失败的 ci 依赖根：门禁一旦放行，下一句 require 就炸，绝不产生真实出码。 */
const NO_CI_ENV = { MINIPROGRAM_CI_PATH: path.join(APP_ROOT, 'no-such-mp-ci-9136') };

const pkg = require('../package.json') as { scripts: Record<string, string> };

/**
 * 去掉注释后再判（「注释里写着」不算代码）。
 * `(^|[^:])` 是为了不把 `https://…` 当成行注释切掉。
 */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const readScript = (file: string) => fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf-8');

/** 数一个字符串里出现几次（不用正则，避免 needle 里的特殊字符转义坑）。 */
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/**
 * 「出码载体」= 源码里 `new Project(` 的脚本 —— 那是 miniprogram-ci 出码/上传的必需构造，
 * 比「文件里提到 miniprogram-ci」精确（readRegisteredPages 之类不会出现它）。
 */
const outputScripts = (): string[] => fs.readdirSync(SCRIPTS_DIR)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => codeOnly(readScript(f)).includes('new Project('))
  .sort();

// ============================================================ W1 载体自己先过门禁

describe('W1 · 谁驱动 miniprogram-ci 出码，谁就必须自己先过门禁', () => {
  it('当前出码载体就是 preview.js / upload.js 两个（新增出码脚本时这条先红）', () => {
    expect(outputScripts()).toEqual(['preview.js', 'upload.js']);
  });

  it('每个出码载体都调 runGateOrExit，且门禁排在 new Project( 之前（先判定再动手）', () => {
    for (const file of outputScripts()) {
      const code = codeOnly(readScript(file));
      expect(code).toContain('runGateOrExit(');
      expect(code.indexOf('runGateOrExit(')).toBeLessThan(code.indexOf('new Project('));
    }
  });

  it('门禁调用早于 require(miniprogram-ci)：站错目录时先看到真判据，不是下游连带错误', () => {
    for (const file of outputScripts()) {
      const code = codeOnly(readScript(file));
      const gateAt = code.indexOf('runGateOrExit(');
      // 载体都从 MINIPROGRAM_CI_PATH 或字面量 'miniprogram-ci' 取依赖；两者都应出现在门禁之后
      const hits = ['miniprogram-ci', 'MINIPROGRAM_CI_PATH']
        .map((n) => code.indexOf(n))
        .filter((i) => i >= 0);
      // 先证「依赖加载点确实被找到了」，否则下面那条断言会恒真（Math.min() 为 Infinity 也 GreaterThan）
      expect(hits.length).toBeGreaterThan(0);
      expect(Math.min(...hits)).toBeGreaterThan(gateAt);
    }
  });

  it('每个出码载体只调一次 runGateOrExit，且都不自己 runPreflight / printReport', () => {
    for (const file of outputScripts()) {
      const code = codeOnly(readScript(file));
      expect(countOf(code, 'runGateOrExit(')).toBe(1);
      expect(code).not.toContain('runPreflight');
      expect(code).not.toContain('printReport');
    }
  });
});

// ============================================================ W2 npm 入口接线

describe('W2 · npm 入口指向的必须是那两个出码载体', () => {
  it('`npm run preview` → node scripts/preview.js', () => {
    expect(pkg.scripts.preview).toBe('node scripts/preview.js');
  });

  it('`npm run upload` → node scripts/upload.js', () => {
    expect(pkg.scripts.upload).toBe('node scripts/upload.js');
  });

  it('两个入口指向的文件都真实存在，且就是 W1 认出的载体（入口与载体不许分叉）', () => {
    const carriers = outputScripts();
    for (const name of ['preview', 'upload']) {
      const m = /^node (scripts\/[\w.-]+\.js)$/.exec(pkg.scripts[name] || '');
      expect(m).not.toBeNull();
      const rel = m![1].replace(/^scripts\//, '');
      expect(fs.existsSync(path.join(SCRIPTS_DIR, rel))).toBe(true);
      expect(carriers).toContain(rel);
    }
  });
});

// ============================================================ W3 一份实现

describe('W3 · 判据只有一份实现（仓库根共享层），两个 app 都 require 它', () => {
  it('共享层文件存在', () => {
    expect(fs.existsSync(SHARED_ABS)).toBe(true);
  });

  it('科豆的两个载体 require 的是共享层，而不是本地的第二份 preflight', () => {
    for (const file of outputScripts()) {
      const code = codeOnly(readScript(file));
      expect(code).toContain("require('../../../scripts/lib/miniprogram-preflight')");
    }
  });

  it('大橙子侧的 preflight.js 是薄壳：require 同一份共享层', () => {
    const shell = codeOnly(fs.readFileSync(path.join(DACHENGZI_SCRIPTS, 'preflight.js'), 'utf-8'));
    expect(shell).toContain("require('../../../scripts/lib/miniprogram-preflight')");
  });

  it('科豆 scripts/ 下不存在第二份判据（没有 preflight.js，也没有判据关键词的实现）', () => {
    // 🔴 这条是「以后有人图省事又复制一份」的绊线。复制 preflight.js 会让 scripts/ 里
    //    出现一个带 ALLOWED_DIR_NAME / KEY_EXT / isKeyFile 的文件。
    const files = fs.readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith('.js'));
    expect(files).not.toContain('preflight.js');
    for (const file of files) {
      const code = codeOnly(readScript(file));
      expect(code).not.toContain('ALLOWED_DIR_NAME');
      expect(code).not.toMatch(/KEY_EXT|isKeyFile/);
      expect(code).not.toContain('runPreflight');
      expect(code).not.toContain('printReport');
    }
  });

  it('大橙子薄壳里不含判据实现（只许注入默认根 + 透出共享层）', () => {
    const shell = codeOnly(fs.readFileSync(path.join(DACHENGZI_SCRIPTS, 'preflight.js'), 'utf-8'));
    expect(shell).not.toContain('ALLOWED_DIR_NAME');
    expect(shell).not.toMatch(/KEY_EXT|isKeyFile/);
    // 导出符号里有 runPreflight 这个名字（兼容要求），但**不许自己定义一份**
    expect(shell).not.toContain('function runPreflight');
    expect(shell).not.toContain('function printReport');
    expect(shell).not.toContain('fail(');
    // 🔴 大橙子的 P1 必须继续用「默认版本真源清单」（utils/version.ts），
    //    不许在薄壳里声明成空 —— 那等于把「站错到 1.0.14 老目录」最灵敏的信号关掉。
    expect(shell).not.toContain('versionSources');
  });

  it('共享层里 DEFAULT_VERSION_SOURCES 仍然默认只认 utils/version.ts（默认口径不许放宽）', () => {
    const shared = fs.readFileSync(SHARED_ABS, 'utf-8');
    const m = /const DEFAULT_VERSION_SOURCES = \[([\s\S]*?)\];/.exec(shared);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("rel: 'utils/version.ts'");
    expect(m![1]).toContain("constName: 'APP_VERSION'");
  });
});

// ============================================================ W4 根一致性 / 参数透传

describe('W4 · 门禁查的根 == 出码的根；参数按同一套解析器透传', () => {
  it('两个载体都先 delete gateOpts.root，再用本包根（不接受 --root 指到别处）', () => {
    for (const file of outputScripts()) {
      const code = codeOnly(readScript(file));
      const delAt = code.indexOf('delete gateOpts.root');
      expect(delAt).toBeGreaterThan(-1);
      // delete 之后必须立刻落回本包根
      expect(code).toContain("gateOpts.root = path.join(__dirname, '..')");
      expect(delAt).toBeLessThan(code.indexOf("gateOpts.root = path.join(__dirname, '..')"));
    }
  });

  it('两个载体的 mode 固定 ci（走 miniprogram-ci：P2 靠 packOptions.ignore 兜，P6 不判开发者工具）', () => {
    for (const file of outputScripts()) {
      expect(codeOnly(readScript(file))).toContain("gateOpts.mode = 'ci'");
    }
  });

  it('两个载体都声明 versionSources（本包没有编译期版本常量），且这是共享层支持的显式配置', () => {
    for (const file of outputScripts()) {
      expect(codeOnly(readScript(file))).toContain('gateOpts.versionSources = []');
    }
    const shared = fs.readFileSync(SHARED_ABS, 'utf-8');
    expect(shared).toContain('Array.isArray(opts.versionSources)');
  });

  it('解析器来自共享层：逃生口参数一个都不少（--skip-preflight 等不许被门禁吃掉）', () => {
    const shared = fs.readFileSync(SHARED_ABS, 'utf-8');
    for (const flag of [
      '--expect-version', '--expect-sha', '--require-dir',
      '--allow-any-dir', '--allow-dirty', '--skip-preflight',
    ]) {
      expect(shared).toContain(flag);
    }
  });
});

// ============================================================ W5 行为面：真的拦得住

interface RunResult {
  status: number | null;
  /** stdout + stderr 合并（只看「说了什么」，不看走哪个流） */
  out: string;
}

function runScript(relScript: string, args: string[] = []): RunResult {
  // 🔴 显式写索引签名，别写成 `const env = { ...process.env, ...NO_CI_ENV }`：
  //    TS 的对象 spread 在「先 spread 带索引签名的 process.env、再 spread 一个具体对象」时
  //    会把索引签名**丢掉**，推断结果只剩 `{ MINIPROGRAM_CI_PATH: string }`，
  //    于是下一行 `delete env.MINIPROGRAM_PREFLIGHT_GATE` 报 TS2339（`npm run typecheck` 红）。
  //    显式标注只影响编译期，运行时对象形状完全不变。
  const env: Record<string, string | undefined> = {
    ...(process.env as Record<string, string | undefined>),
    ...NO_CI_ENV,
  };
  // 父进程若残留「门禁已跑过」的状态，子进程会直接跳过判定 → 本组用例会假绿。显式清掉。
  delete env.MINIPROGRAM_PREFLIGHT_GATE;
  const r = spawnSync(process.execPath, [path.join(APP_ROOT, relScript), ...args], {
    cwd: APP_ROOT,
    encoding: 'utf-8',
    env,
    timeout: 60000,
  });
  const stdout = r.stdout == null ? '' : String(r.stdout);
  const stderr = r.stderr == null ? '' : String(r.stderr);
  return { status: r.status, out: `${stdout}${stderr}` };
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

describe('W5 · 真跑一次：门禁先于出码动作执行，且零产物', () => {
  it('直连 preview.js 且版本不可能满足 → 被门禁拦下（exit 1，一份报表，零产物）', () => {
    const before = ciOutputFileCount();
    const r = runScript('scripts/preview.js', ['--expect-version', '9.9.9']);

    expect(r.status).toBe(1);
    // ① 门禁确实跑了，而且只跑一次
    expect(countOf(r.out, REPORT_HEAD)).toBe(1);
    // ② 顺序证据：第一个 [Preflight]/[Preview] 标签必须是 Preflight
    //    （改造前这里是 [Preview] 缺少私钥 —— 出码动作抢在门禁前面）
    const tags = r.out.match(/\[(Preflight|Preview)\]/g) || [];
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0]).toBe('[Preflight]');
    // ③ 拦下来的是 P1 判据本身，不是别的错
    expect(r.out).toContain('package.json 版本 ≠ 期望版本');
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
    expect(r.out).not.toContain('[Upload] 开始上传');
    expect(r.out).not.toContain('[Upload] 版本号:');
  });
});

// ============================================================ W6 P3 --expect-sha 正/负向

/**
 * 共享层判据模块（**只读** require，不 mock 任何一行）。
 * 用 `SHARED_ABS`（与 W3 同一路径常量）取，保证测的就是「两个 app 共用的那一份」。
 */
const preflight = require(SHARED_ABS) as {
  runPreflight: (opts: Record<string, unknown>) => {
    ok: boolean;
    failures: Array<{ code: string; title: string; detail: string; hint?: string }>;
    info: { headSha: string; branch: string; expectSha: string; warnings: string[] };
  };
};

/**
 * 假 git：把 HEAD、分支、worktree 顶层钉死。
 *
 * 🔴 为什么不用真 git（即「真读本仓库 HEAD」）：
 *    真跑会连带引入本机/CI 的真实状态 —— 顶层目录名要过 P4 白名单、`git status` 决定 P5、
 *    要不要开发者工具 CLI 决定 P6。任何一项随环境漂，这条用例就不是在测 P3 了，
 *    而是「本机 luck 好不好」，红/绿都失去意义。P3 要钉的是「注入的 HEAD 与期望 sha 的比对」，
 *    所以把 HEAD 变成输入。
 *
 * ⚠️ 参数顺序有讲究：`status --short` 里也含 `--short`，必须先判 status。
 */
const fakeGit = (branch: string, sha: string, toplevel: string) =>
  (_cmd: unknown, args: unknown): string => {
    const a = (args as string[]).join(' ');
    if (a.includes('status')) return '';
    if (a.includes('--abbrev-ref')) return `${branch}\n`;
    if (a.includes('--show-toplevel')) return `${toplevel}\n`;
    if (a.includes('--short')) return `${sha}\n`;
    throw new Error(`unexpected git args: ${a}`);
  };

/** W6 造的临时目录，收尾统一清掉（不碰仓库里任何真实文件）。 */
const w6TmpDirs: string[] = [];

/**
 * 造一个「科豆形态」的临时包根：只有 package.json，**没有** utils/version.ts。
 *
 * 🔴 `versionSources: []` 是科豆的真实声明（见 miniprogram-preflight.js 的 DEFAULT_VERSION_SOURCES
 *    注释）：科豆包里没有编译期版本常量，P1 只核 package.json.version。
 *    不传这个参数就会去核一个科豆根本没有的文件 → P1 假红，掩盖真正要断言的 P3。
 */
function mkKedouFixture(version = '1.0.13'): { root: string; toplevel: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kedou-preflight-'));
  w6TmpDirs.push(base);
  const root = path.join(base, 'apps', 'kedou-ai-minigram');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version }, null, 2),
  );
  // worktree 顶层名走 P4 白名单形态（web_system-<四位任务号>），把 P4 摘出去，只留 P3 说话
  return { root, toplevel: path.join(base, 'web_system-9136') };
}

describe('W6 · P3 --expect-sha 正/负向（isSameSha 坏掉时科豆这边必须变红）', () => {
  afterAll(() => {
    for (const d of w6TmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  /**
   * 🔴 本条就是补的那个缺口（2026-11-27）：
   *    `isSameSha` 一旦退化成恒 false，**本条必须红** —— 这是它存在的唯一理由。
   *    实测变异（把 scripts/lib/git-identity.js 的 isSameSha 改成 `return false`）：
   *    W6 正向红、负向仍绿（负向本来就在断言「不符」），W1–W5 全绿 —— 与预期一致。
   */
  it('声明的 --expect-sha 与 HEAD 一致 → 通过，且留下可 grep 的「核对通过」痕', () => {
    const { root, toplevel } = mkKedouFixture();
    const r = preflight.runPreflight({
      root,
      mode: 'ci', // 走 miniprogram-ci：P6 不判开发者工具 CLI（与本机装没装无关）
      versionSources: [],
      expectSha: 'abc1234',
      execFileSync: fakeGit('feat/kedou-preflight-w6', 'abc1234', toplevel),
    });

    // ① 判定通过：不能有任何失败项
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    // ② 比对确实发生了（而不是「没读到 git 就跳过」）：
    //    P3 只有在 isSameSha 命中时才推这条 warning —— 它是「正向路径真的走到了」的唯一可视证据
    expect(r.info.headSha).toBe('abc1234');
    expect(r.info.expectSha).toBe('abc1234');
    expect(r.info.warnings.join('\n')).toContain('--expect-sha 核对通过');
    // ③ 反面证据：通过不等于「漏判」—— 任何 P3 失败痕迹都不许有
    expect(r.failures.some((f) => f.code === 'P3')).toBe(false);
  });

  /**
   * 负向：期望 sha 与 HEAD 不符 → **必须**报 P3 失败（且要说清「当前是哪个、期望是哪个」）。
   *
   * 🔴 为什么负向也要在科豆有一份：只有正向时，「无论给什么 sha 都放行」这种坏法照样绿
   *    （正向能过=真；但负向漏判=假）。两个方向都有网，这条判据才算被钉住。
   *    与大橙子 tests/preflight.test.ts「P3 工作区身份」组的写法逐条对齐。
   */
  it('声明的 --expect-sha 与 HEAD 不符 → 失败（站错 worktree），且 detail 里两个 sha 都在', () => {
    const { root, toplevel } = mkKedouFixture();
    const r = preflight.runPreflight({
      root,
      mode: 'ci',
      versionSources: [],
      expectSha: '019d282b',
      execFileSync: fakeGit('feat/kedou-preflight-w6', 'abc1234', toplevel),
    });

    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.code === 'P3');
    expect(f).toBeDefined();
    expect(f!.title).toContain('HEAD 与期望 sha 不符');
    // 报错三要素里的「现象」：两个值都要在，人才知道差在哪
    expect(f!.detail).toContain('abc1234');
    expect(f!.detail).toContain('019d282b');
    // 且不许把「不符」写成「核对通过」
    expect(r.info.warnings.join('\n')).not.toContain('--expect-sha 核对通过');
  });
});
