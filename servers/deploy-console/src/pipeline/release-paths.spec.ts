import * as path from 'path';
import {
  moduleArtifactsRoot,
  moduleArtifactDir,
  moduleArtifactEntry,
  moduleArtifactUrl,
  manifestUrl,
  toCommitId,
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

/**
 * 入参 commit 归一化的防回归测试。
 *
 * 背景（线上已复现）：控制台「Commit」下拉的数据来自版本列表，值是**完整版本引用**
 * `default/91f744b`；提交接口按纯短哈希设计 → 直接透传会 400「目标 commit 含非法字符」。
 * 归一化后：完整引用取末段，纯哈希原样，空值=分支最新。
 */
describe('toCommitId（入参 commit 归一化）', () => {
  it('完整版本引用 → 取末段纯 commit', () => {
    expect(toCommitId('default/91f744b')).toBe('91f744b');
    expect(toCommitId('v5-e2e/abc1234')).toBe('abc1234');
  });

  it('纯 commit / 前后空格 → 原样（去空格）', () => {
    expect(toCommitId('91f744b')).toBe('91f744b');
    expect(toCommitId(' 91f744b ')).toBe('91f744b');
  });

  it('空值 → undefined（= 走分支最新提交）', () => {
    expect(toCommitId(undefined)).toBeUndefined();
    expect(toCommitId(null)).toBeUndefined();
    expect(toCommitId('')).toBeUndefined();
    expect(toCommitId('   ')).toBeUndefined();
  });

  it('归一化结果应能通过提交白名单（不含 /）', () => {
    const re = /^[A-Za-z0-9._-]{4,64}$/;
    expect(re.test(toCommitId('default/91f744b') as string)).toBe(true);
  });
});
