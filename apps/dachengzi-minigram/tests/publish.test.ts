/// <reference types="node" />
/**
 * 一键发布脚本 scripts/publish.js 单元测试
 *
 * 覆盖：
 *   ① parseArgs：--to / --page / --no-push / --notify 各分支 + 位置参数 + 未知 flag。
 *   ② resolveTarget：缺省取 single / --to 命中 / --to 未命中（列会话名）/ sessions 空。
 *   ③ pushQr 失败路径：png 不存在 → exit 1。
 *   ④ pushQr 成功路径：media upload 后发 markdown + image 两条；meta 缺失走兜底文案。
 *
 * 隔离手段：`jest.mock('child_process')` 把 execFileSync 换成 jest.fn —— 它是 publish.js
 * 里所有 wecom-cli 调用的唯一出口（publish.js 顶部以 `const childProcess = require('child_process')`
 * 引用同一模块对象，因此 mock 能被内部 run/wecom 命中）。入口已用 `require.main === module`
 * 保护，被 require 时不会执行 main()。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

interface PublishModule {
  parseArgs: (argv: string[]) => {
    _: string[];
    to?: string;
    page?: string;
    noPush?: boolean;
    notify?: boolean;
  };
  resolveTarget: (toName?: string) => {
    chat_id: string;
    chat_name?: string;
    chat_type?: string;
  };
  pushQr: (pngPath: string, toName?: string) => void;
}

// 与 publish.js 内部的 require('child_process') 命中同一份 mock
const mockChildProcess = jest.requireMock('child_process') as { execFileSync: jest.Mock };
const publish = require('../scripts/publish') as PublishModule;

/** 构造 wecom-cli「会话列表」返回体 */
const sessionsJson = (sessions: unknown[]) => JSON.stringify({ sessions });

describe('parseArgs', () => {
  it('位置参数 + --page + --to + --no-push 齐上', () => {
    expect(
      publish.parseArgs(['q.png', '--page', 'pages/chat/index/index', '--to', '张三', '--no-push']),
    ).toEqual({ _: ['q.png'], page: 'pages/chat/index/index', to: '张三', noPush: true });
  });

  it('--notify 与 --no-push 同时存在、互不覆盖', () => {
    expect(publish.parseArgs(['--notify', '--no-push'])).toEqual({
      _: [],
      notify: true,
      noPush: true,
    });
  });

  it('空参数 → 空位置参数、无 flag', () => {
    expect(publish.parseArgs([])).toEqual({ _: [] });
  });

  it('未知 flag 不进 flag 字段，按位置参数保留', () => {
    expect(publish.parseArgs(['--unknown', 'x'])).toEqual({ _: ['--unknown', 'x'] });
  });
});

describe('resolveTarget', () => {
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    mockChildProcess.execFileSync.mockReset();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('缺省取第一个 single 会话（授权人本人）', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      sessionsJson([
        { chat_id: 'c1', chat_name: '本人', chat_type: 'single' },
        { chat_id: 'g1', chat_name: '项目群', chat_type: 'group' },
      ]),
    );
    expect(publish.resolveTarget().chat_id).toBe('c1');
  });

  it('--to 按会话名精确匹配命中', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      sessionsJson([
        { chat_id: 'c1', chat_name: '本人', chat_type: 'single' },
        { chat_id: 'g1', chat_name: '项目群', chat_type: 'group' },
      ]),
    );
    expect(publish.resolveTarget('项目群').chat_id).toBe('g1');
  });

  it('--to 未命中 → exit 1 且错误信息列出会话名', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      sessionsJson([{ chat_id: 'c1', chat_name: '本人', chat_type: 'single' }]),
    );
    expect(() => publish.resolveTarget('不存在')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('不存在'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('本人'));
  });

  it('sessions 为空 → exit 1', () => {
    mockChildProcess.execFileSync.mockReturnValue(sessionsJson([]));
    expect(() => publish.resolveTarget()).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('pushQr', () => {
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    mockChildProcess.execFileSync.mockReset();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('png 不存在 → exit 1 并给出可读提示', () => {
    expect(() => publish.pushQr('/nonexistent/qr-does-not-exist.png')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('不存在'));
  });

  it('成功：media upload 后发 markdown + image 两条；meta 缺失走兜底文案', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
    const png = path.join(tmp, 'qr.png');
    fs.writeFileSync(png, 'fake-png-bytes');
    try {
      mockChildProcess.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === 'message' && args[1] === 'aibot' && args[2] === 'sessions') {
          return JSON.stringify({ sessions: [{ chat_id: 'c1', chat_name: '本人', chat_type: 'single' }] });
        }
        if (args[0] === 'media' && args[1] === 'upload') {
          return JSON.stringify({ media_id: 'media_1' });
        }
        return JSON.stringify({ errcode: 0 });
      });

      publish.pushQr(png);

      const sendCalls = mockChildProcess.execFileSync.mock.calls.filter(
        (c) => c[0] === 'wecom-cli' && c[1][0] === 'message' && c[1][2] === 'send',
      );
      expect(sendCalls).toHaveLength(2);

      const payloads = sendCalls.map((c) => JSON.parse(c[1][4]));
      const markdown = payloads.find((p) => p.msg_type === 'markdown');
      const image = payloads.find((p) => p.msg_type === 'image');
      expect(markdown).toBeDefined();
      expect(image).toBeDefined();
      expect(markdown.markdown.content).toContain('小程序预览码');
      expect(image.image.media_id).toBe('media_1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
