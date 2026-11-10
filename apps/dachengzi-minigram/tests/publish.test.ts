/// <reference types="node" />
/**
 * 一键发布脚本 scripts/publish.js 单元测试
 *
 * 覆盖：
 *   ① parseArgs：--to / --page / --mode / --no-push / --notify 各分支 + 位置参数 + 未知 flag。
 *   ② resolveMode：缺省 cli / cli / ci / 未知值 exit 1（cli/ci 模式分支选择）。
 *   ③ resolveTarget：缺省取 group / 无 group 回退 single / 无 group 也无 single 报错 / --to 命中 / --to 未命中（列会话名）/ sessions 空。
 *   ④ resolveCliBinary：WECHAT_DEVTOOLS_CLI 优先 → which cli 回退 → 字面量 cli 兜底。
 *   ⑤ cliPreviewArgs / cliUploadArgs：cli 命令参数拼装。
 *   ⑥ gitShortSha：git rev-parse 结果 / 失败降级 unknown。
 *   ⑦ buildCliMeta：版本 / git sha / 有效期 / 默认口径（版本取 package.json、25 分钟）。
 *   ⑧ writeCliMeta：写到 png 同名的 .meta.json。
 *   ⑨ pushQr 失败路径：png 不存在 → exit 1。
 *   ⑩ pushQr 成功路径：media upload 后发 markdown + image 两条；meta 缺失走兜底文案。
 *
 * 隔离手段：`jest.mock('child_process')` 把 execFileSync 换成 jest.fn —— 它是 publish.js
 * 里所有 wecom-cli / git / which / cli 调用的唯一出口（publish.js 顶部以
 * `const childProcess = require('child_process')` 引用同一模块对象，因此 mock 能被内部
 * run/wecom/resolveCliBinary/gitShortSha 命中）。入口已用 `require.main === module` 保护，
 * 被 require 时不会执行 main()。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}));

interface CliMeta {
  version: string;
  gitSha: string;
  pagePath: string;
  createdAt: string;
  createdAtText: string;
  expireAt: string;
  expireAtText: string;
  expireAtMs: number;
  ttlMinutes: number;
  hint: string;
}

interface CliMetaOpts {
  version?: string;
  gitSha?: string;
  ttlMinutes?: number;
  now?: number;
}

interface PublishModule {
  parseArgs: (argv: string[]) => {
    _: string[];
    to?: string;
    page?: string;
    mode?: string;
    noPush?: boolean;
    notify?: boolean;
  };
  resolveMode: (mode?: string) => string;
  resolveTarget: (toName?: string) => {
    chat_id: string;
    chat_name?: string;
    chat_type?: string;
  };
  resolveCliBinary: (env?: Record<string, string | undefined>) => string;
  gitShortSha: () => string;
  cliPreviewArgs: (appRoot: string, outPath: string) => string[];
  cliUploadArgs: (appRoot: string, version: string, desc: string) => string[];
  buildCliMeta: (pagePath?: string, opts?: CliMetaOpts) => CliMeta;
  writeCliMeta: (outPath: string, meta: Record<string, unknown>) => string;
  pushQr: (pngPath: string, toName?: string) => void;
  uploadMedia: (filePath: string, type?: string) => {
    media_id?: string;
    type?: string;
    created_at?: string;
    errmsg?: string;
    errcode?: number;
  };
  sendMarkdown: (chatId: string, content: string) => unknown;
  sendImage: (chatId: string, mediaId: string) => unknown;
  cmdUpload: (opts: { mode?: string; to?: string; notify?: boolean }) => void;
}

// 与 publish.js 内部的 require('child_process') 命中同一份 mock
const mockChildProcess = jest.requireMock('child_process') as { execFileSync: jest.Mock };
const publish = require('../scripts/publish') as PublishModule;
const pkg = require('../package.json') as { version: string };

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

  it('--mode cli / --mode ci 进入 mode 字段', () => {
    expect(publish.parseArgs(['--mode', 'cli'])).toEqual({ _: [], mode: 'cli' });
    expect(publish.parseArgs(['--mode', 'ci', '--no-push'])).toEqual({ _: [], mode: 'ci', noPush: true });
  });

  it('空参数 → 空位置参数、无 flag（无 mode 字段，由 resolveMode 兜底 cli）', () => {
    expect(publish.parseArgs([])).toEqual({ _: [] });
  });

  it('未知 flag 不进 flag 字段，按位置参数保留', () => {
    expect(publish.parseArgs(['--unknown', 'x'])).toEqual({ _: ['--unknown', 'x'] });
  });
});

describe('resolveMode（cli/ci 模式分支选择）', () => {
  it('缺省 / 空串 → cli', () => {
    expect(publish.resolveMode(undefined)).toBe('cli');
    expect(publish.resolveMode('')).toBe('cli');
  });

  it('cli / ci 原样返回', () => {
    expect(publish.resolveMode('cli')).toBe('cli');
    expect(publish.resolveMode('ci')).toBe('ci');
  });

  it('未知值 → exit 1 并提示支持范围', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => publish.resolveMode('bogus')).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('bogus'));
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
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

  it('缺省取第一个 group 会话（如公司群）', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      sessionsJson([
        { chat_id: 'c1', chat_name: '本人', chat_type: 'single' },
        { chat_id: 'g1', chat_name: '项目群', chat_type: 'group' },
        { chat_id: 'g2', chat_name: '公司群', chat_type: 'group' },
      ]),
    );
    expect(publish.resolveTarget().chat_id).toBe('g1');
  });

  it('无 group → 回退取第一个 single 会话', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      sessionsJson([{ chat_id: 'c1', chat_name: '本人', chat_type: 'single' }]),
    );
    expect(publish.resolveTarget().chat_id).toBe('c1');
  });

  it('无 group 也无 single → exit 1 并提示 --to', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      sessionsJson([{ chat_id: 'x1', chat_name: '其他', chat_type: 'channel' }]),
    );
    expect(() => publish.resolveTarget()).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('--to'));
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

describe('resolveCliBinary（CLI 路径解析，不硬编码）', () => {
  const OLD = process.env.WECHAT_DEVTOOLS_CLI;

  afterEach(() => {
    if (OLD === undefined) delete process.env.WECHAT_DEVTOOLS_CLI;
    else process.env.WECHAT_DEVTOOLS_CLI = OLD;
    mockChildProcess.execFileSync.mockReset();
  });

  it('环境变量 WECHAT_DEVTOOLS_CLI 优先', () => {
    process.env.WECHAT_DEVTOOLS_CLI = '/opt/wechat-devtools/cli';
    expect(publish.resolveCliBinary()).toBe('/opt/wechat-devtools/cli');
  });

  it('无环境变量 → 回退 which cli', () => {
    delete process.env.WECHAT_DEVTOOLS_CLI;
    mockChildProcess.execFileSync.mockReturnValue('/usr/local/bin/cli\n');
    expect(publish.resolveCliBinary()).toBe('/usr/local/bin/cli');
  });

  it('which 失败 → 回退字面量 cli', () => {
    delete process.env.WECHAT_DEVTOOLS_CLI;
    mockChildProcess.execFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(publish.resolveCliBinary()).toBe('cli');
  });
});

describe('cli 命令参数拼装', () => {
  it('cliPreviewArgs：--qr-output 用项目内绝对路径', () => {
    expect(
      publish.cliPreviewArgs('/repo/app', '/repo/app/.ci-output/cli-preview-qr.png'),
    ).toEqual([
      'preview',
      '--project',
      '/repo/app',
      '--qr-format',
      'image',
      '--qr-output',
      '/repo/app/.ci-output/cli-preview-qr.png',
    ]);
  });

  it('cliUploadArgs：-v 版本 -d 描述', () => {
    expect(publish.cliUploadArgs('/repo/app', '1.2.3', 'cli 上传 v1.2.3')).toEqual([
      'upload',
      '--project',
      '/repo/app',
      '-v',
      '1.2.3',
      '-d',
      'cli 上传 v1.2.3',
    ]);
  });
});

describe('gitShortSha', () => {
  beforeEach(() => mockChildProcess.execFileSync.mockReset());

  it('返回 git rev-parse --short HEAD 结果（去首尾空白）', () => {
    mockChildProcess.execFileSync.mockReturnValue('abc1234\n');
    expect(publish.gitShortSha()).toBe('abc1234');
  });

  it('git 失败 → 降级 unknown', () => {
    mockChildProcess.execFileSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(publish.gitShortSha()).toBe('unknown');
  });
});

describe('buildCliMeta（版本 / git sha / 有效期拼装）', () => {
  beforeEach(() => mockChildProcess.execFileSync.mockReset());

  it('注入 version/gitSha/ttl/now → 拼出版本与有效期', () => {
    const now = Date.UTC(2026, 10, 10, 10, 0, 0);
    const meta = publish.buildCliMeta('pages/home/index/index', {
      version: '9.9.9',
      gitSha: 'abc1234',
      ttlMinutes: 30,
      now,
    });
    expect(meta.version).toBe('9.9.9');
    expect(meta.gitSha).toBe('abc1234');
    expect(meta.pagePath).toBe('pages/home/index/index');
    expect(meta.ttlMinutes).toBe(30);
    expect(meta.expireAtMs).toBe(now + 30 * 60 * 1000);
    expect(meta.expireAt).toBe(new Date(now + 30 * 60 * 1000).toISOString());
    expect(meta.expireAtText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('不注入 version → 取 package.json.version；ttl 默认 25 分钟', () => {
    const now = Date.UTC(2026, 10, 10, 10, 0, 0);
    const meta = publish.buildCliMeta('pages/chat/index/index', { gitSha: 'def5678', now });
    expect(meta.version).toBe(pkg.version);
    expect(meta.ttlMinutes).toBe(25);
    expect(meta.expireAtMs).toBe(now + 25 * 60 * 1000);
  });
});

describe('writeCliMeta', () => {
  it('写到 png 同名的 .meta.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-meta-'));
    const png = path.join(tmp, 'cli-preview-qr.png');
    try {
      const dest = publish.writeCliMeta(png, { version: '1.0.0' });
      expect(dest).toBe(path.join(tmp, 'cli-preview-qr.meta.json'));
      const parsed = JSON.parse(fs.readFileSync(dest, 'utf-8'));
      expect(parsed.version).toBe('1.0.0');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
          return JSON.stringify({ success: true, media_id: 'media_1' });
        }
        return JSON.stringify({ success: true });
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
      expect(markdown.markdown.content).toBe('小程序开发版预览二维码（扫码体验）');
      expect(image.image.media_id).toBe('media_1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('成功：有 meta 时发一行说明（版本 + 有效期）', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
    const png = path.join(tmp, 'qr.png');
    fs.writeFileSync(png, 'fake-png-bytes');
    fs.writeFileSync(
      path.join(tmp, 'qr.meta.json'),
      JSON.stringify({ version: '1.2.3', expireAtText: '2026-11-10 10:25:00' }),
    );
    try {
      mockChildProcess.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === 'message' && args[1] === 'aibot' && args[2] === 'sessions') {
          return JSON.stringify({ sessions: [{ chat_id: 'g1', chat_name: '公司群', chat_type: 'group' }] });
        }
        if (args[0] === 'media' && args[1] === 'upload') {
          return JSON.stringify({ success: true, media_id: 'media_1' });
        }
        return JSON.stringify({ success: true });
      });

      publish.pushQr(png);

      const sendCalls = mockChildProcess.execFileSync.mock.calls.filter(
        (c) => c[0] === 'wecom-cli' && c[1][0] === 'message' && c[1][2] === 'send',
      );
      const payloads = sendCalls.map((c) => JSON.parse(c[1][4]));
      const markdown = payloads.find((p) => p.msg_type === 'markdown');
      expect(markdown).toBeDefined();
      expect(markdown.markdown.content).toBe('小程序开发版预览二维码 v1.2.3 · 有效期至 2026-11-10 10:25:00');
      expect(markdown.markdown.content).not.toContain('\n');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('发送 / 上传结果校验（假绿修复）', () => {
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    mockChildProcess.execFileSync.mockReset();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('sendMarkdown 返回 success:false → exit 1 且打印 errmsg/errcode', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      JSON.stringify({ success: false, errmsg: 'xxx', errcode: 40001 }),
    );
    expect(() => publish.sendMarkdown('c1', 'hello')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('xxx'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('40001'));
  });

  it('pushQr：send 失败时不打印「已推送」', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-test-'));
    const png = path.join(tmp, 'qr.png');
    fs.writeFileSync(png, 'fake-png-bytes');
    try {
      mockChildProcess.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === 'message' && args[1] === 'aibot' && args[2] === 'sessions') {
          return JSON.stringify({ sessions: [{ chat_id: 'c1', chat_name: '本人', chat_type: 'single' }] });
        }
        if (args[0] === 'media' && args[1] === 'upload') {
          return JSON.stringify({ success: true, media_id: 'media_1' });
        }
        return JSON.stringify({ success: false, errmsg: 'xxx' });
      });

      expect(() => publish.pushQr(png)).toThrow('process.exit');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('已推送'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('sendMarkdown 返回 success:true → 正常走完（不 exit）', () => {
    mockChildProcess.execFileSync.mockReturnValue(JSON.stringify({ success: true }));
    expect(() => publish.sendMarkdown('c1', 'hello')).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('uploadMedia 返回体无 media_id（media 真实结构，无 success 字段）→ exit 1', () => {
    mockChildProcess.execFileSync.mockReturnValue(JSON.stringify({ type: 'image' }));
    expect(() => publish.uploadMedia('/tmp/x.png')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('media_id'));
  });

  it('uploadMedia 返回体带 errmsg/errcode 但无 media_id → exit 1 且打印两者', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      JSON.stringify({ errcode: 40001, errmsg: 'upload fail' }),
    );
    expect(() => publish.uploadMedia('/tmp/x.png')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('upload fail'));
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('40001'));
  });
});

describe('uploadMedia（type 透传 + media_id 校验）', () => {
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

  const mediaUploadCall = () => mockChildProcess.execFileSync.mock.calls.find(
    (c) => c[0] === 'wecom-cli' && c[1][0] === 'media' && c[1][1] === 'upload',
  );

  it('不传 type → 默认带 type:"image"，返回 media_id 算成功', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      JSON.stringify({ type: 'image', media_id: 'media_1', created_at: '2026-11-10T00:00:00Z' }),
    );
    const res = publish.uploadMedia('/tmp/qr.png');
    expect(res.media_id).toBe('media_1');
    expect(exitSpy).not.toHaveBeenCalled();

    const call = mediaUploadCall();
    expect(call).toBeDefined();
    const payload = JSON.parse(call![1][3]);
    expect(payload.file_path).toBe('/tmp/qr.png');
    expect(payload.type).toBe('image');
  });

  it('显式 type:"file" → 覆盖默认值透传', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      JSON.stringify({ type: 'file', media_id: 'media_2', created_at: '2026-11-10T00:00:00Z' }),
    );
    publish.uploadMedia('/tmp/f.txt', 'file');
    const payload = JSON.parse(mediaUploadCall()![1][3]);
    expect(payload.type).toBe('file');
    expect(payload.file_path).toBe('/tmp/f.txt');
  });

  it('返回 media_id 为空串 → exit 1', () => {
    mockChildProcess.execFileSync.mockReturnValue(
      JSON.stringify({ type: 'image', media_id: '' }),
    );
    expect(() => publish.uploadMedia('/tmp/qr.png')).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('media_id'));
  });
});

describe('cmdUpload --notify 通知文案（措辞：开发版本 ≠ 体验版）', () => {
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    mockChildProcess.execFileSync.mockReset();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('--notify 的 markdown 通知写「已上传开发版本」，不再误写「已上传体验版」', () => {
    mockChildProcess.execFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'git') return 'abc1234\n';
      if (cmd === 'which') return '/usr/local/bin/cli\n';
      if (cmd === 'wecom-cli' && args[0] === 'message' && args[1] === 'aibot' && args[2] === 'sessions') {
        return sessionsJson([{ chat_id: 'g1', chat_name: '公司群', chat_type: 'group' }]);
      }
      if (cmd === 'wecom-cli' && args[0] === 'message' && args[1] === 'aibot' && args[2] === 'send') {
        return JSON.stringify({ success: true });
      }
      return ''; // cli upload / node upload.js 的返回值未被消费
    });

    publish.cmdUpload({ notify: true });

    const sendCalls = mockChildProcess.execFileSync.mock.calls.filter(
      (c) => c[0] === 'wecom-cli' && c[1][0] === 'message' && c[1][2] === 'send',
    );
    expect(sendCalls).toHaveLength(1);
    const payload = JSON.parse(sendCalls[0][1][4]);
    expect(payload.markdown.content).toContain('已上传开发版本');
    expect(payload.markdown.content).not.toContain('已上传体验版');
    expect(payload.markdown.content).toContain('设为体验版'); // 第二行边界说明保留
  });
});
