import * as path from 'path';
import {
  moduleArtifactsRoot,
  moduleArtifactDir,
  moduleArtifactEntry,
  moduleArtifactUrl,
  manifestUrl,
} from './release-paths';

describe('release-paths（静态产物路径收口）', () => {
  const ws = '/release';

  it('产物根落在 <ws>/servers/gateway/public/static/modules/<key>', () => {
    expect(moduleArtifactsRoot(ws, 'admin')).toBe(
      path.join(ws, 'servers', 'gateway', 'public', 'static', 'modules', 'admin'),
    );
  });

  it('产物目录与入口文件按版本定位', () => {
    const dir = moduleArtifactDir(ws, 'admin', 'abc1234');
    expect(dir).toBe(path.join(moduleArtifactsRoot(ws, 'admin'), 'abc1234'));
    expect(moduleArtifactEntry(ws, 'admin', 'abc1234')).toBe(path.join(dir, 'index.js'));
  });

  it('产物 HTTP URL 指向 gateway 静态路径（verify HEAD 探活用）', () => {
    expect(moduleArtifactUrl('http://localhost:6000', 'admin', 'abc1234')).toBe(
      'http://localhost:6000/static/modules/admin/abc1234/index.js',
    );
  });

  it('manifest URL 指向 __manifest__', () => {
    expect(manifestUrl('http://localhost:6000')).toBe('http://localhost:6000/__manifest__');
  });
});
