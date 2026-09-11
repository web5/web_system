import { buildVersionRef, assertCommitMatch } from './git-identity';

describe('buildVersionRef（R6 版本身份）', () => {
  it('有模板 key → <key>/<commit>', () => {
    expect(buildVersionRef('default', '1a2b3c4')).toBe('default/1a2b3c4');
  });

  it('无模板 key → 纯 commit（legacy 兼容）', () => {
    expect(buildVersionRef(undefined, '1a2b3c4')).toBe('1a2b3c4');
  });
});

/**
 * 拉码一致性断言的防回归测试。
 *
 * 背景：内置 pull 在 `rev-parse` 失败时会**跳过 reset 继续构建**，即「传了版本引用
 * 却打出分支最新代码」。此测试锁定「请求了 commit 就必须一致，否则中止发布」。
 */
describe('assertCommitMatch（拉码一致性断言）', () => {
  const FULL_A = 'a'.repeat(40);
  const FULL_B = 'b'.repeat(40);

  it('未请求 commit（未指定版本）→ 不校验', () => {
    expect(() => assertCommitMatch(undefined, null, null)).not.toThrow();
  });

  it('全哈希一致 → 通过（比对用全哈希，避免短哈希位数差异误判）', () => {
    expect(() => assertCommitMatch('1a2b3c4', FULL_A, FULL_A)).not.toThrow();
  });

  it('实际 HEAD 与请求不一致 → 抛错并给出实际值/期望值', () => {
    expect(() => assertCommitMatch('1a2b3c4', FULL_A, FULL_B)).toThrow(/拉码结果与请求不一致/);
    expect(() => assertCommitMatch('1a2b3c4', FULL_A, FULL_B)).toThrow(/aaaaaaaa/);
  });

  it('请求的 commit 不可达（wantFull=null）→ 抛错', () => {
    expect(() => assertCommitMatch('deadbeef', null, FULL_A)).toThrow(/不可达/);
  });
});
