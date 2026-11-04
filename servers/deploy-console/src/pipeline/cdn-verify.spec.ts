import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CDN_MANIFEST_FILE,
  buildLocalManifest,
  describeDiff,
  diffManifests,
  normalizeRel,
  parseSha256Manifest,
  sha256File,
} from './cdn-verify';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const H3 = 'c'.repeat(64);

describe('parseSha256Manifest（sha256sum 输出解析）', () => {
  it('解析标准两列格式', () => {
    const m = parseSha256Manifest(`${H1}  index.js\n${H2}  chunks/1.js\n`);
    expect([...m.entries()]).toEqual([
      ['index.js', H1],
      ['chunks/1.js', H2],
    ]);
  });

  it('兼容二进制模式星号与 ./ 前缀', () => {
    const m = parseSha256Manifest(`${H1} *./index.js\r\n`);
    expect(m.get('index.js')).toBe(H1);
  });

  it('哈希统一小写', () => {
    const m = parseSha256Manifest(`${'A'.repeat(64)}  index.js`);
    expect(m.get('index.js')).toBe('a'.repeat(64));
  });

  it('忽略空行与非法行，但只要有一条合法就不抛错', () => {
    const m = parseSha256Manifest(`\nnot-a-line\n${H1}  index.js\n`);
    expect(m.size).toBe(1);
  });

  it('一条都解析不出来时抛错（空清单会让对账结论误导成「全没传」）', () => {
    expect(() => parseSha256Manifest('<html>404</html>')).toThrow(/清单解析为空/);
    expect(() => parseSha256Manifest('')).toThrow(/清单解析为空/);
  });
});

describe('normalizeRel', () => {
  it('去 ./ 前缀、折叠双斜杠、转 posix', () => {
    expect(normalizeRel('./a//b\\c.js')).toBe('a/b/c.js');
    expect(normalizeRel('/abs/x.js')).toBe('abs/x.js');
  });
});

describe('buildLocalManifest（本地产物清单）', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-verify-'));
    fs.writeFileSync(path.join(dir, 'index.js'), 'export const x = 1;');
    fs.mkdirSync(path.join(dir, 'chunks'));
    fs.writeFileSync(path.join(dir, 'chunks', 'a.js'), 'export const a = 1');
    fs.writeFileSync(path.join(dir, CDN_MANIFEST_FILE), `${H1}  index.js\n`);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('递归产出相对路径 → sha256，且排除清单自身', async () => {
    const m = await buildLocalManifest(dir);
    expect([...m.keys()].sort()).toEqual(['chunks/a.js', 'index.js']);
    expect(m.get('index.js')).toBe(await sha256File(path.join(dir, 'index.js')));
  });

  it('不跟随符号链接（静态根软链事故后加的口径）', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.js'), 'x');
    fs.symlinkSync(outside, path.join(dir, 'linked'), 'dir');
    const m = await buildLocalManifest(dir);
    expect([...m.keys()].sort()).toEqual(['chunks/a.js', 'index.js']);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('空目录返回空 Map（由调用方判失败）', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-empty-'));
    expect((await buildLocalManifest(empty)).size).toBe(0);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe('diffManifests（集合比对）', () => {
  it('完全一致 → ok', () => {
    const local = new Map([
      ['index.js', H1],
      ['chunks/a.js', H2],
    ]);
    const d = diffManifests(local, new Map(local));
    expect(d).toEqual({ ok: true, missing: [], extra: [], mismatch: [] });
  });

  it('本地有远端没有 → missing', () => {
    const d = diffManifests(new Map([['index.js', H1], ['b.js', H2]]), new Map([['index.js', H1]]));
    expect(d.ok).toBe(false);
    expect(d.missing).toEqual(['b.js']);
  });

  it('远端多出 → extra（清单陈旧 / 传了别的产物）', () => {
    const d = diffManifests(new Map([['index.js', H1]]), new Map([['index.js', H1], ['old.js', H3]]));
    expect(d.ok).toBe(false);
    expect(d.extra).toEqual(['old.js']);
  });

  it('同名不同内容 → mismatch', () => {
    const d = diffManifests(new Map([['index.js', H1]]), new Map([['index.js', H2]]));
    expect(d.ok).toBe(false);
    expect(d.mismatch).toEqual(['index.js']);
  });

  it('差异条数受 limit 限制（日志不刷屏）', () => {
    const local = new Map(Array.from({ length: 9 }, (_, i) => [`f${i}.js`, H1]));
    const d = diffManifests(local, new Map(), 3);
    expect(d.missing).toHaveLength(3);
  });
});

describe('describeDiff（失败原因文案）', () => {
  it('带文件数与三类差异', () => {
    const msg = describeDiff(
      { ok: false, missing: ['a.js'], extra: ['b.js'], mismatch: ['c.js'] },
      2,
      2,
    );
    expect(msg).toContain('本地 2 个文件 / 远端清单 2 个');
    expect(msg).toContain('未上传: a.js');
    expect(msg).toContain('远端多出: b.js');
    expect(msg).toContain('内容不一致: c.js');
  });
});
