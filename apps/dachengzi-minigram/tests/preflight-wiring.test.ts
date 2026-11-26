/// <reference types="node" />
/**
 * 门禁「接线」测试（H1 + H2 + H3）
 *
 * 只测两件事，**不测 preflight 的判定逻辑**（那由 preflight.test.ts 负责）：
 *
 *   H1 · 入口接线：`npm run preview` / `npm run upload` 必须落到 publish.js，
 *        不能直连 scripts/preview.js / scripts/upload.js —— 门禁只挂在 publish.js 里，
 *        直连文件就等于绕过门禁。这一类的病根不是「没写门禁」而是「门禁没接线」：
 *        改一处 package.json 胜过三处文档提醒，所以用机器断言钉住。
 *
 *   H2 · 参数透传：publish.js 调门禁时必须带 expectVersion。
 *        preflight.js 侧本来支持 opts.expectVersion（P1 版本一致性），
 *        调用方不传 = 能力在、始终不生效。所以这里断言的是「传进去了」，不是「判定对不对」。
 *
 *   H3 · 单一编排（台账 9122）：publish.js **不得**自己 runPreflight + printReport + exit
 *        —— 那会让「跑/打印/退出」出现第二份。编排只在 preflight.runGateOrExit 一份，
 *        publish.js 只允许调它。本组断言用「runPreflight 调用次数为 0」把这条钉死。
 *
 * 隔离：jest.mock 掉 child_process（publish.js 唯一外部调用出口）与 ../scripts/preflight，
 *       断言 runGateOrExit 的入参而不真跑 git / 不碰真包。
 */

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

describe('H1 · npm 出码入口必须经过 publish.js（门禁唯一挂载点）', () => {
  it('`npm run preview` 走 publish.js preview 子命令', () => {
    expect(pkg.scripts.preview).toBe('node scripts/publish.js preview');
  });

  it('`npm run upload` 走 publish.js upload 子命令', () => {
    expect(pkg.scripts.upload).toBe('node scripts/publish.js upload');
  });

  /**
   * 绊线：npm 脚本层面不允许再有人直连 preview.js / upload.js。
   * 一旦有人加回 `"xxx": "node scripts/preview.js"`，本断言即红。
   *
   * ⚠️ 本条只覆盖 npm 入口。scripts/preview-push.js 内部用 spawnSync 调 preview.js，
   *    它不是 npm 入口，断言不到 —— 那条路的安全由「门禁已下沉到 preview.js 本体」保证
   *    （台账 9122；用例见 tests/preflight-entry-sink.test.ts）。
   */
  it('除 preview / upload 外，没有任何 npm 脚本直连 preview.js / upload.js', () => {
    const direct = Object.entries(pkg.scripts)
      .filter(([, cmd]) => /node scripts\/(preview|upload)\.js/.test(cmd))
      .map(([name]) => name)
      .sort();
    expect(direct).toEqual([]);
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
