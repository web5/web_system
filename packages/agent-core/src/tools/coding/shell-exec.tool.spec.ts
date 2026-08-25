import { ShellExecTool } from './shell-exec.tool';
import { ToolContext } from '../../interfaces/tool.interface';

const ctx = (confirm?: (m: string) => Promise<boolean>): ToolContext => ({
  userId: 'u',
  runId: 'r',
  deps: {},
  confirm,
});

describe('ShellExecTool', () => {
  const tool = new ShellExecTool();

  it('非白名单且非需确认命令被拒绝', async () => {
    const r = await tool.execute({ command: 'evil-command foo' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toContain('不在允许范围');
  });

  it('完全禁用命令（sudo）即使 confirm true 也拒绝', async () => {
    const r = await tool.execute({ command: 'sudo rm /x' }, ctx(async () => true));
    expect(r.success).toBe(false);
    expect(r.error).toContain('禁用');
  });

  it('删除命令在无 confirm 时默认拒绝', async () => {
    const r = await tool.execute({ command: 'rm /tmp/nonexist_x' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toContain('拒绝');
  });

  it('删除命令在 confirm 返回 false 时拒绝', async () => {
    const r = await tool.execute({ command: 'rm /tmp/nonexist_x' }, ctx(async () => false));
    expect(r.success).toBe(false);
    expect(r.error).toContain('拒绝');
  });

  it('删除命令在 confirm 返回 true 时放行执行', async () => {
    // confirm=true → 放行，执行 rm（文件不存在会报错，但证明走了确认放行路径而非"已拒绝"）
    const r = await tool.execute({ command: 'rm /tmp/nonexist_x_12345' }, ctx(async () => true));
    expect(r.success).toBe(false);
    expect(r.error).not.toContain('拒绝');
  });

  it('覆盖写重定向（>）需确认', async () => {
    const r = await tool.execute({ command: 'echo hi > /tmp/x' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toContain('危险');
  });

  it('普通只读命令直接执行（无需确认）', async () => {
    const r = await tool.execute({ command: 'echo hello' }, ctx());
    expect(r.success).toBe(true);
    expect(r.content).toContain('hello');
  });
});
