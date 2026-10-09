import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  envArtifactsDir,
  entryPointerJs,
  hasEnvVersion,
  listEnvVersions,
  readEnvEntryPointer,
  writeEnvEntryPointer,
} from './entry-pointer';

/**
 * 入口指针单测（P1 · 验收判据 V6 的机器可执行部分）
 *
 * 锁定 T1 定稿写法 A' 的 **System.register 版**（命名导出 + default 双透传）：
 * 产物是 SystemJS（`MF_FORMAT=system`），指针若写成原生 ESM，`System.import()`
 * 会在解析阶段抛 `Unexpected token 'export'`（2026-09-21 门户加载失败事故）——
 * 属整模块白屏级回归，故用断言锁死写法，同时锁死 `readEnvEntryPointer` 的解析兼容。
 */
describe('entry-pointer（入口指针 T1 定稿 A′）', () => {
  let ws: string;

  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ptr-'));
  });
  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  const mkVersion = (appKey: string, envId: string, version: string, withCss = false) => {
    const dir = path.join(envArtifactsDir(ws, appKey, envId), version);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), `// ${version}`);
    if (withCss) fs.writeFileSync(path.join(dir, 'index.css'), `.v{content:'${version}'}`);
  };

  it('指针内容为 System.register（命名导出 + default 双透传），锁定 A′ 写法', () => {
    expect(entryPointerJs('1a2b3c4')).toBe(
      "System.register(['./1a2b3c4/index.js'], function (_export) {\n" +
        "  'use strict';\n" +
        '  return {\n' +
        '    setters: [function (m) { _export(m); }],\n' +
        '    execute: function () {}\n' +
        '  };\n' +
        '});\n',
    );
  });

  it('指针内容必须是 System.register（原生 ESM 写法在 SystemJS 下整模块加载失败）', () => {
    const js = entryPointerJs('1a2b3c4');
    expect(js.startsWith('System.register(')).toBe(true);
    expect(js).not.toContain('export * from');
    expect(js).not.toContain('export { default } from');
  });

  it('写入后读回指向当前版本（切换版本 = 只改指针）', () => {
    mkVersion('admin', 'dev', 'v1');
    mkVersion('admin', 'dev', 'v2');

    writeEnvEntryPointer(ws, 'admin', 'dev', 'v1');
    expect(readEnvEntryPointer(ws, 'admin', 'dev')).toBe('v1');

    // 再切到 v2：只重写指针文件，不改动任何版本目录
    const before = fs.readdirSync(path.join(envArtifactsDir(ws, 'admin', 'dev'))).sort();
    writeEnvEntryPointer(ws, 'admin', 'dev', 'v2');
    expect(readEnvEntryPointer(ws, 'admin', 'dev')).toBe('v2');
    expect(fs.readdirSync(path.join(envArtifactsDir(ws, 'admin', 'dev'))).sort()).toEqual(before);

    // 版本目录内容原封不动（未重新构建）
    expect(fs.readFileSync(path.join(envArtifactsDir(ws, 'admin', 'dev'), 'v1', 'index.js'), 'utf-8')).toBe(
      '// v1',
    );
  });

  it('版本目录含 index.css 时同步写样式指针', () => {
    mkVersion('admin', 'dev', 'v1', true);
    const res = writeEnvEntryPointer(ws, 'admin', 'dev', 'v1');
    expect(res.css).toContain('index.css');
    expect(fs.readFileSync(res.css!, 'utf-8')).toBe("@import url('./v1/index.css');\n");
  });

  it('无 index.css 时不写样式指针（返回 null）', () => {
    mkVersion('admin', 'dev', 'v1');
    expect(writeEnvEntryPointer(ws, 'admin', 'dev', 'v1').css).toBeNull();
  });

  it('环境隔离：不同 envId 各写各的指针', () => {
    mkVersion('admin', 'dev', 'v1');
    mkVersion('admin', '1', 'v9');
    writeEnvEntryPointer(ws, 'admin', 'dev', 'v1');
    writeEnvEntryPointer(ws, 'admin', '1', 'v9');
    expect(readEnvEntryPointer(ws, 'admin', 'dev')).toBe('v1');
    expect(readEnvEntryPointer(ws, 'admin', '1')).toBe('v9');
  });

  it('hasEnvVersion：产物入口不存在时为 false', () => {
    mkVersion('admin', 'dev', 'v1');
    expect(hasEnvVersion(ws, 'admin', 'dev', 'v1')).toBe(true);
    expect(hasEnvVersion(ws, 'admin', 'dev', 'nope')).toBe(false);
    expect(hasEnvVersion(ws, 'admin', '999', 'v1')).toBe(false);
  });

  it('listEnvVersions：按 mtime 倒序，兼容命名空间二级布局', () => {
    mkVersion('admin', 'dev', 'v1');
    mkVersion('admin', 'dev', 'default/v2');
    const p1 = path.join(envArtifactsDir(ws, 'admin', 'dev'), 'v1');
    const p2 = path.join(envArtifactsDir(ws, 'admin', 'dev'), 'default', 'v2');
    fs.utimesSync(p1, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    fs.utimesSync(p2, new Date(), new Date());

    expect(listEnvVersions(ws, 'admin', 'dev')).toEqual(['default/v2', 'v1']);
    expect(listEnvVersions(ws, 'admin', 'nope')).toEqual([]);
  });

  it('指针缺失时读回 null（不抛异常）', () => {
    expect(readEnvEntryPointer(ws, 'admin', 'dev')).toBeNull();
  });
});
