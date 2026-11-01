import { resolveToolShellBody } from './service-tools';

describe('resolveToolShellBody（工具目录 shell 正文引用）', () => {
  const row = (over: Partial<{ kind: string; available: boolean; command: string }> = {}) => ({
    kind: 'shell',
    available: true,
    command: 'echo hi',
    ...over,
  });

  it('tool 为空 → null（action 没写 tool 就当 shell 处理，不走工具目录）', () => {
    expect(resolveToolShellBody(undefined, row())).toBeNull();
    expect(resolveToolShellBody(null, row())).toBeNull();
    expect(resolveToolShellBody('', row())).toBeNull();
  });

  it('工具目录里查不到 → null', () => {
    expect(resolveToolShellBody('restart-clean', null)).toBeNull();
    expect(resolveToolShellBody('restart-clean', undefined)).toBeNull();
  });

  it('kind 不是 shell（service 内置工具）→ null：正文不在库里，实现在代码', () => {
    expect(resolveToolShellBody('restart', row({ kind: 'service' }))).toBeNull();
  });

  it('工具已停用 → null（停用即不可引用，显式优于静默跑旧正文）', () => {
    expect(resolveToolShellBody('restart-clean', row({ available: false }))).toBeNull();
  });

  it('正文为空 → null', () => {
    expect(resolveToolShellBody('restart-clean', row({ command: '' }))).toBeNull();
  });

  it('正文只有空白 → null（避免执行一个空脚本被当成成功）', () => {
    expect(resolveToolShellBody('restart-clean', row({ command: '   \n\t ' }))).toBeNull();
  });

  it('正常：返回去空白后的正文', () => {
    expect(resolveToolShellBody('restart-clean', row({ command: 'echo hi\n' }))).toBe('echo hi');
  });

  it('available 缺省（老数据无该列）→ 视为可用', () => {
    expect(resolveToolShellBody('restart-clean', { kind: 'shell', command: 'echo hi' })).toBe(
      'echo hi',
    );
  });

  it('kind 缺失 → null（无法判定是不是 shell 工具）', () => {
    expect(resolveToolShellBody('restart-clean', { available: true, command: 'echo hi' })).toBeNull();
  });

  it('变异验证：去掉 available 判断会让「已停用工具」被引用执行', () => {
    // 若实现漏掉 available === false 的判断，这条会拿到正文（非 null）→ 失败
    expect(resolveToolShellBody('restart-clean', row({ available: false, command: 'rm -rf /' }))).toBeNull();
  });
});
