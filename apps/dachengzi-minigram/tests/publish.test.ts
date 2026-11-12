/// <reference types="node" />
/**
 * 发布脚本 scripts/publish.js 单元测试
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
 *   ⑪ cmdUpload --notify 分步通知文案（开发版本 ≠ 体验版，脚本不代做后台操作）。
 *   ⑫ cmdUpload 不带 --notify 时也控制台打印「开发版本已上传 → 后续人工步骤」指引。
 *   ⑬ cmdTrial / cmdRelease 纯打印输出 + 零副作用（execFileSync / wecom / 写文件均不被调用）。
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
  cmdTrial: () => void;
  cmdRelease: () => void;
  NOTIFY_UPLOAD: (version: string) => string;
  GUIDE_TRIAL: (version: string) => string;
  GUIDE_RELEASE: (version: string) => string;
  GUIDE_UPLOAD_CONSOLE: (version: string) => string;
}

// 与 publish.js 内部的 require('child_process') 命中同一份 mock
const mockChildProcess = jest.requireMock('child_process') as { execFileSync: jest.Mock };
const publish = require('../scripts/publish') as PublishModule;
const pkg = require('../package.json') as { version: string };
// publish.js 里 `const fs = require('fs')` 拿到的就是这个对象；ES 命名空间（import * as fs）
// 在 ts-jest 下属性不可重定义，故零副作用断言要 spy 这个原始 CommonJS 模块对象。
const fsCore = require('fs') as typeof fs;

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

/** cmdUpload 的 cli 上传路径打桩：which/git 返回字符串，wecom 各调用返回业务成功体 */
function mockUploadCliOk() {
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
}

describe('cmdUpload --notify 通知文案（开发版本 ≠ 体验版；脚本不代做后台操作）', () => {
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

  it('--notify 通知写「已上传开发版本」，并给出人工分步指引（不并列成一步、不自称已推进）', () => {
    mockUploadCliOk();

    publish.cmdUpload({ notify: true });

    const sendCalls = mockChildProcess.execFileSync.mock.calls.filter(
      (c) => c[0] === 'wecom-cli' && c[1][0] === 'message' && c[1][2] === 'send',
    );
    expect(sendCalls).toHaveLength(1);
    const payload = JSON.parse(sendCalls[0][1][4]);
    const content = payload.markdown.content as string;
    // §2.2 保留的三条
    expect(content).toContain('已上传开发版本');
    expect(content).not.toContain('已上传体验版');
    expect(content).toContain('设为体验版');
    // 新增正向断言：分步 / 人工 / 正式版 / 脚本不代做（锁住 §3.1 新文案）
    expect(content).toContain('提交审核');
    expect(content).toContain('版本管理');
    expect(content).toContain('人工');
    expect(content).toContain('正式版');
    expect(content).toContain('脚本不代做');
    expect(content).toContain('体验成员');
    expect(content).toContain('**体验版**（可选，连 prod）');
    expect(content).toContain('**正式版**（连 prod）');
    expect(content).toContain('分步指引：npm run publish -- trial ｜ npm run publish -- release');
    // 「设为体验版 / 提交审核」并列成一步的旧误导不得回归
    expect(content).not.toContain('设为体验版并提交审核');
  });
});

describe('cmdUpload 不带 --notify：控制台仍打印「脚本到此为止」指引', () => {
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

  it('不带 --notify 也打印 §3.4 四行指引，且不发任何企业微信消息', () => {
    mockUploadCliOk();

    publish.cmdUpload({ notify: false });

    const logs = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logs).toContain(`[Publish] ✅ 开发版本 v${pkg.version} 已上传到公众平台后台。`);
    expect(logs).toContain('🔴 脚本到此为止：设为体验版 / 提交审核 / 发布均为人工操作，脚本不代做。');
    expect(logs).toContain('   体验版指引：npm run publish -- trial');
    expect(logs).toContain('   正式版指引：npm run publish -- release');

    // 不带 --notify 时零推送
    const sendCalls = mockChildProcess.execFileSync.mock.calls.filter(
      (c) => c[0] === 'wecom-cli' && c[1][0] === 'message' && c[1][2] === 'send',
    );
    expect(sendCalls).toHaveLength(0);
  });
});

describe('cmdTrial / cmdRelease：纯打印人工分步指引（零副作用）', () => {
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    mockChildProcess.execFileSync.mockReset();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    writeSpy = jest.spyOn(fsCore, 'writeFileSync').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('cmdTrial 输出体验版设置指引：本脚本不操作后台 / 人工步骤 / 前置检查 / 连 dev / 体验成员', () => {
    publish.cmdTrial();

    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain(`[Publish] 体验版设置指引 · v${pkg.version}`);
    expect(out).toContain('🔴 本脚本不操作微信公众平台，以下均为人工步骤。');
    expect(out).toContain('【前置检查】');
    expect(out).toContain('【人工步骤】');
    expect(out).toContain(`  · package.json 版本已递增（当前 v${pkg.version}；微信要求递增，重复会被拒）`);
    expect(out).toContain('  · 体验成员已添加：公众平台 → 管理 → 成员管理 → 体验成员');
    expect(out).toContain('  · 体验版连 https://kedouai.com（prod），请在 request 合法域名登记');
    expect(out).toContain(`  2. 选中 v${pkg.version} → 点击「设为体验版」`);
    expect(out).toContain('勿手填 path');
    expect(out).toContain('官方口径 7 天');
    expect(out).toContain('【下一步】正式版：npm run publish -- release');
  });

  it('cmdRelease 输出正式版发布指引：前置检查 / 提审 / 驳回 / 发布 / 回滚 / 连 prod', () => {
    publish.cmdRelease();

    const out = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(out).toContain(`[Publish] 正式版发布指引 · v${pkg.version}`);
    expect(out).toContain('🔴 本脚本不操作微信公众平台，以下均为人工步骤。');
    expect(out).toContain('【前置检查】');
    expect(out).toContain('  · prod 后端已发布：https://kedouai.com');
    expect(out).toContain('  · AppSecret 已同步；隐私指引已声明并发布');
    expect(out).toContain('  1. 登录 https://mp.weixin.qq.com/ → 管理 → 版本管理 → 开发版本 → 提交审核');
    expect(out).toContain('审核时长以微信侧为准');
    expect(out).toContain('  3. 若驳回：按驳回原因修改 → 重新上传开发版本 → 重新提审');
    expect(out).toContain('  4. 审核通过 → 点击「发布」（全量或分阶段灰度）');
    expect(out).toContain('  5. 发布后真机验证：正式版连 prod，不打到 dev');
    expect(out).toContain('【回滚】');
    expect(out).toContain('版本回退');
    expect(out).toContain('撤回审核');
    expect(out).toContain('【环境】正式版/体验版连 https://kedouai.com（prod）；开发版连 dev。');
  });

  it('零副作用：cmdTrial / cmdRelease 不调 execFileSync（含 wecom/media/git/which/cli）、不写文件、不 exit', () => {
    publish.cmdTrial();
    publish.cmdRelease();

    expect(mockChildProcess.execFileSync).not.toHaveBeenCalled();
    const wecomCalls = mockChildProcess.execFileSync.mock.calls.filter((c) => c[0] === 'wecom-cli');
    expect(wecomCalls).toHaveLength(0);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('输出与 §3 文案常量同源（version 取 package.json.version）', () => {
    publish.cmdTrial();
    expect(logSpy).toHaveBeenCalledWith(publish.GUIDE_TRIAL(pkg.version));
    publish.cmdRelease();
    expect(logSpy).toHaveBeenCalledWith(publish.GUIDE_RELEASE(pkg.version));
  });
});
