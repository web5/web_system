import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CdnAssetVerifier } from './cdn-asset-verifier.service';
import { CDN_MANIFEST_FILE, sha256File } from './cdn-verify';
import { HttpProbeService } from '../probe/http-probe.service';

type Cfg = Record<string, string | undefined>;

function makeSvc(cfg: Cfg, probe: Partial<HttpProbeService>) {
  const configService = { get: (k: string) => cfg[k] } as never;
  return new CdnAssetVerifier(configService, probe as HttpProbeService);
}

const ORIGIN = 'https://dev.kedouai.com/cdn';
const MANIFEST_URL = `${ORIGIN}/dev/portal/abc1234/${CDN_MANIFEST_FILE}`;

describe('CdnAssetVerifier（切指针前 CDN 硬门禁）', () => {
  let dir: string;
  let indexHash: string;
  let chunkHash: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-verifier-'));
    fs.writeFileSync(path.join(dir, 'index.js'), 'export const x = 1;');
    fs.mkdirSync(path.join(dir, 'chunks'));
    fs.writeFileSync(path.join(dir, 'chunks', 'a.js'), 'export const a = 1');
    indexHash = await sha256File(path.join(dir, 'index.js'));
    chunkHash = await sha256File(path.join(dir, 'chunks', 'a.js'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const goodManifest = () => `${indexHash}  index.js\n${chunkHash}  chunks/a.js\n`;

  it('legacy 模式：直接返回 null，不发任何请求（默认零变化）', async () => {
    const getText = jest.fn();
    const request = jest.fn();
    const svc = makeSvc({}, { getText, request } as never);
    expect(svc.isCdnMode()).toBe(false);
    await expect(
      svc.assertReady({ env: 'dev', app: 'portal', commit: 'abc1234', localDir: dir }),
    ).resolves.toBeNull();
    expect(getText).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('cdn 模式但未配 CDN_ORIGIN：抛错且不静默跳过', async () => {
    const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn' }, { getText: jest.fn(), request: jest.fn() } as never);
    await expect(
      svc.assertReady({ env: 'dev', app: 'portal', commit: 'abc1234', localDir: dir }),
    ).rejects.toThrow(/CDN_ORIGIN/);
  });

  it('CDN_ORIGIN 不是完整 URL base：抛错', async () => {
    const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: '/cdn' }, {} as never);
    await expect(
      svc.assertReady({ env: 'dev', app: 'portal', commit: 'abc1234', localDir: dir }),
    ).rejects.toThrow(/完整 URL base/);
  });

  it('本地产物目录为空：抛错（构建无产出不得继续切指针）', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-empty-'));
    const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: ORIGIN }, {} as never);
    await expect(
      svc.assertReady({ env: 'dev', app: 'portal', commit: 'abc1234', localDir: empty }),
    ).rejects.toThrow(/产物目录为空/);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('清单取不到（404）：抛错并点明 nginx / 路径 / 目录三种常见原因', async () => {
    const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: ORIGIN }, {
      getText: jest.fn(async () => ({ ok: false, status: 404, text: '' })),
      request: jest.fn(),
    } as never);
    await expect(
      svc.assertReady({ env: 'dev', app: 'portal', commit: 'abc1234', localDir: dir }),
    ).rejects.toThrow(new RegExp(`${MANIFEST_URL}.*HTTP 404`));
  });

  it('清单与本地内容不一致：抛错并列出差异文件', async () => {
    const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: ORIGIN }, {
      getText: jest.fn(async () => ({
        ok: true,
        status: 200,
        text: `${'0'.repeat(64)}  index.js\n${'0'.repeat(64)}  chunks/a.js\n`,
      })),
      request: jest.fn(),
    } as never);
    await expect(
      svc.assertReady({ env: 'dev', app: 'portal', commit: 'abc1234', localDir: dir }),
    ).rejects.toThrow(/内容不一致: .*index\.js/);
  });

  it('文件集合不齐（少一个）：抛错', async () => {
    const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: ORIGIN }, {
      getText: jest.fn(async () => ({ ok: true, status: 200, text: `${indexHash}  index.js\n` })),
      request: jest.fn(),
    } as never);
    await expect(
      svc.assertReady({ env: 'dev', app: 'portal', commit: 'abc1234', localDir: dir }),
    ).rejects.toThrow(/未上传: chunks\/a\.js/);
  });

  it('全绿：返回文件数，且入口 index.js 单独 HEAD 过', async () => {
    const request = jest.fn(async () => ({ ok: true, status: 200 }));
    const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: ORIGIN }, {
      getText: jest.fn(async () => ({ ok: true, status: 200, text: goodManifest() })),
      request,
    } as never);
    const logs: string[] = [];
    const r = await svc.assertReady({
      env: 'dev',
      app: 'portal',
      commit: 'abc1234',
      localDir: dir,
      log: (l) => logs.push(l),
    });
    expect(r?.files).toBe(2);
    expect(request).toHaveBeenCalledWith(
      `${ORIGIN}/dev/portal/abc1234/index.js`,
      'HEAD',
      expect.any(Number),
    );
    expect(logs.join('\n')).toContain('CDN 校验通过');
  });

  it('清单对但入口不可访问：抛错（防「清单在、JS 服务不出去」）', async () => {
    const svc = makeSvc({ CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: ORIGIN }, {
      getText: jest.fn(async () => ({ ok: true, status: 200, text: goodManifest() })),
      request: jest.fn(async () => ({ ok: false, status: 403 })),
    } as never);
    await expect(
      svc.assertReady({ env: 'dev', app: 'portal', commit: 'abc1234', localDir: dir }),
    ).rejects.toThrow(/入口不可访问.*HTTP 403/);
  });

  it('支持按环境覆盖 origin（CDN_ORIGIN_<ENV> 优先）', async () => {
    const getText = jest.fn(async () => ({ ok: true, status: 200, text: goodManifest() }));
    const svc = makeSvc(
      { CDN_LAYOUT_MODE: 'cdn', CDN_ORIGIN: 'https://fallback.example/cdn', CDN_ORIGIN_PROD: 'https://kedouai.com/cdn' },
      { getText, request: jest.fn(async () => ({ ok: true, status: 200 })) } as never,
    );
    await svc.assertReady({ env: 'prod', app: 'portal', commit: 'abc1234', localDir: dir });
    expect(getText).toHaveBeenCalledWith(
      `https://kedouai.com/cdn/prod/portal/abc1234/${CDN_MANIFEST_FILE}`,
      expect.any(Number),
    );
  });
});
