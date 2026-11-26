/// <reference types="node" />
/**
 * 门禁「接线」测试（H1 + H2 + H3）
 *
 * 只测两件事，**不测 preflight 的判定逻辑**（那由 preflight.test.ts 负责）：
 *
 *   H1 · 入口接线：`npm run preview` / `npm run upload` 必须落到 publish.js ——
 *        **不再是因为「直连会绕过门禁」**（那份门禁已在 9122 下沉到 preview.js / upload.js 本体），
 *        而是因为 publish.js 还要负责推送、--desc、控制台指引等 npm 层语义：
 *        一处入口 = 一处参数口径。改一处 package.json 胜过三处文档提醒。
 *
 *   H2 · 参数透传：publish.js 调门禁时必须带 expectVersion。
 *        preflight.js 侧本来支持 opts.expectVersion（P1 版本一致性），
 *        调用方不传 = 能力在、始终不生效。所以这里断言的是「传进去了」，不是「判定对不对」。
 *
 *   H3 · 单一编排（台账 9122）：publish.js **不得**自己 runPreflight + printReport + exit
 *        —— 那会让「跑/打印/退出」出现第二份。编排只在 preflight.runGateOrExit 一份，
 *        publish.js 只允许调它。本组断言用「runPreflight 调用次数为 0」把这条钉死。
 *
 *   H4 · 出码载体快照（台账 9122）：凡是驱动 miniprogram-ci 出码/上传的脚本，必须自己过门禁。
 *        绊线从「谁不许直连」搬到了「谁出码谁必须过门 —— 新增出码脚本会让快照先红」，
 *        因为「直连」这个概念在门禁下沉后已经没有安全含义了。
 *
 * 隔离：jest.mock 掉 child_process（publish.js 唯一外部调用出口）与 ../scripts/preflight，
 *       断言 runGateOrExit 的入参而不真跑 git / 不碰真包。
 *       H4 例外：它只读 scripts/*.js 源码（不执行），不引入任何真实副作用。
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

jest.mock('../scripts/preflight', () => ({
  runGateOrExit: jest.fn(),
  runPreflight: jest.fn(),
  printReport: jest.fn(),
  withGateState: jest.fn((env: Record<string, string>, state?: string) => (
    state
      ? { ...env, MINIPROGRAM_PREFLIGHT_GATE: state }
      : { ...env, MINIPROGRAM_PREFLIGHT_GATE: undefined }
  )),
  GATE_ENV: 'MINIPROGRAM_PREFLIGHT_GATE',
  GATE_DONE: 'done',
  GATE_SKIP: 'skip',
}));

interface PublishModule {
  parseArgs: (argv: string[]) => {
    _: string[];
    expectVersion?: string;
    expectSha?: string;
    requireDir?: string;
  };
  preflightGate: (opts: Record<string, unknown>, sub: 'preview' | 'upload') => unknown;
}

const preflight = jest.requireMock('../scripts/preflight') as {
  runGateOrExit: jest.Mock;
  runPreflight: jest.Mock;
  printReport: jest.Mock;
};
const publish = require('../scripts/publish') as PublishModule;
const pkg = require('../package.json') as { scripts: Record<string, string> };

const OK_RESULT = {
  ok: true,
  info: { mode: 'cli', root: '/tmp/fake-root', projectName: 'dachengzi-minigram' },
  failures: [],
  warnings: [],
};

beforeEach(() => {
  preflight.runGateOrExit.mockReset().mockReturnValue(OK_RESULT);
  preflight.runPreflight.mockReset().mockReturnValue(OK_RESULT);
  preflight.printReport.mockReset();
});

// ---------------------------------------------------------------- H1 入口接线

describe('H1 · npm 出码入口必须经过 publish.js（npm 层参数口径唯一）', () => {
  it('`npm run preview` 走 publish.js preview 子命令', () => {
    expect(pkg.scripts.preview).toBe('node scripts/publish.js preview');
  });

  it('`npm run upload` 走 publish.js upload 子命令', () => {
    expect(pkg.scripts.upload).toBe('node scripts/publish.js upload');
  });

  /**
   * 绊线：npm 脚本层面统一经 publish.js（不直连 preview.js / upload.js）。
   * 一旦有人加回 `"xxx": "node scripts/preview.js"`，本断言即红。
   *
   * 🔴 这条**在 9122 之后换了个理由，仍然保留**：
   *    原来是因为「直连绕过门禁」—— 那个理由已经作废（门禁已下沉到两个脚本本体，
   *    直连也过同一道门，见 tests/preflight-entry-sink.test.ts 的 E1 组）。
   *    现在钉的是「npm 入口统一经 publish.js」：推送、--desc、控制台指引这些 npm 层语义
   *    只有 publish.js 有，另开一个 npm 入口 = 第二套参数口径。
   *    真正的安全属性已搬去 H4（谁出码谁必须自己过门禁）。
   */
  it('除 preview / upload 外，没有任何 npm 脚本直连 preview.js / upload.js', () => {
    const direct = Object.entries(pkg.scripts)
      .filter(([, cmd]) => /node scripts\/(preview|upload)\.js/.test(cmd))
      .map(([name]) => name)
      .sort();
    expect(direct).toEqual([]);
  });
});

// ------------------------------------------------- H4 出码载体快照（台账 9122）

/** 去掉注释后再判（「注释里写着」不算代码；`(^|[^:])` 避开 https:// 被当行注释切掉）。 */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const readScript = (file: string) => fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf-8');

/**
 * 「出码载体」= 源码里 `new Project(` 的脚本 —— 那是 miniprogram-ci 出码/上传的必需构造，
 * 比「文件里提到 miniprogram-ci」精确（preview-push.js 只是 require.resolve 探可加载性，不出码）。
 */
const outputScripts = (): string[] => fs.readdirSync(SCRIPTS_DIR)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => codeOnly(readScript(f)).includes('new Project('))
  .sort();

describe('H4 · 谁驱动 miniprogram-ci 出码，谁就必须自己过门禁', () => {
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
});

// ---------------------------------------------------------------- H2 参数透传

describe('H2 · publish.js 必须把 expectVersion 透传给 preflight', () => {
  it('parseArgs 识别 `--expect-version <ver>`', () => {
    expect(publish.parseArgs(['--expect-version', '1.0.18'])).toEqual({
      _: [],
      expectVersion: '1.0.18',
    });
  });

  it('parseArgs 识别 `--expect-version=<ver>`', () => {
    expect(publish.parseArgs(['--expect-version=1.0.18'])).toEqual({
      _: [],
      expectVersion: '1.0.18',
    });
  });

  it('preflightGate 把 expectVersion 连同 expectSha / requireDir 一起透传（preview）', () => {
    publish.preflightGate(
      { expectVersion: '1.0.18', expectSha: '47f74ba8', requireDir: '^web_system-1018-r2$' },
      'preview',
    );
    expect(preflight.runGateOrExit).toHaveBeenCalledTimes(1);
    expect(preflight.runGateOrExit).toHaveBeenCalledWith(
      expect.objectContaining({
        expectVersion: '1.0.18',
        expectSha: '47f74ba8',
        requireDir: '^web_system-1018-r2$',
        mode: 'cli',
      }),
      'preview',
    );
  });

  it('upload 子命令同样透传 expectVersion，并把子命令名交给唯一编排（forUpload 由它决定）', () => {
    publish.preflightGate({ expectVersion: '1.0.18' }, 'upload');
    expect(preflight.runGateOrExit).toHaveBeenCalledWith(
      expect.objectContaining({ expectVersion: '1.0.18' }),
      'upload',
    );
  });

  it('未声明时不伪造默认值（传给 preflight 的是 undefined，由 preflight 自行推导）', () => {
    publish.preflightGate({}, 'preview');
    const arg = preflight.runGateOrExit.mock.calls[0][0] as { expectVersion?: string };
    expect(arg.expectVersion).toBeUndefined();
  });

  it('--skip-preflight 也交给唯一编排处理（publish.js 不自己打印、不自己决定跳过）', () => {
    publish.preflightGate({ skipPreflight: true }, 'preview');
    expect(preflight.runGateOrExit).toHaveBeenCalledWith(
      expect.objectContaining({ skipPreflight: true }),
      'preview',
    );
  });
});

// ------------------------------------------------- H3 编排只有一份（台账 9122）

describe('H3 · publish.js 不得自带第二份编排（跑/打印/退出）', () => {
  it('preflightGate 只调 runGateOrExit，绝不自己 runPreflight / printReport', () => {
    publish.preflightGate({ expectVersion: '1.0.18' }, 'preview');
    publish.preflightGate({}, 'upload');

    expect(preflight.runGateOrExit).toHaveBeenCalledTimes(2);
    expect(preflight.runPreflight).not.toHaveBeenCalled();
    expect(preflight.printReport).not.toHaveBeenCalled();
  });
});
