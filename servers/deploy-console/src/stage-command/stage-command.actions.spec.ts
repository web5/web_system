import { pickActions, validateActions } from './stage-command.service';
import type { StageAction } from '../entities/deploy-module-stage-command.entity';

/**
 * v4 多操作（阶段内 1..N 个执行动作）的防回归测试。
 *
 * 背景：单条 shell 无法满足「失败定位到具体步骤」「一个阶段内混用内置能力与脚本」
 * 「某一步单独设超时/容错」。多操作建立后必须保证：
 *   1) 配置了 actions 就按 actions 执行；
 *   2) **没配 actions 的存量数据必须行为不变**（包装成单操作）——这是兼容底线。
 */
const shellAction = (over: Partial<StageAction> = {}): StageAction => ({
  id: 'a1',
  type: 'shell',
  name: '主操作',
  code: 'echo hi',
  ...over,
});

describe('pickActions（阶段操作序列解析）', () => {
  it('配置了 actions 时按原样返回（过滤 enabled=false）', () => {
    const got = pickActions({
      actions: [
        shellAction({ id: 'a1' }),
        shellAction({ id: 'a2', enabled: false }),
        shellAction({ id: 'a3' }),
      ],
      command: 'legacy',
    });
    expect(got.map((a) => a.id)).toEqual(['a1', 'a3']);
  });

  it('actions 为空时把存量 command 包装成单操作（兼容底线：行为不变）', () => {
    const got = pickActions({ actions: null, command: 'npx vite build', timeoutSec: 600 });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      id: 'a1',
      type: 'shell',
      name: '主操作',
      code: 'npx vite build',
      timeoutSec: 600,
    });
  });

  it('actions 与 command 都为空时返回空数组（走内置逻辑或 fail-fast）', () => {
    expect(pickActions({ actions: null, command: '' })).toEqual([]);
    expect(pickActions({ actions: [], command: '   ' })).toEqual([]);
    expect(pickActions({})).toEqual([]);
  });

  it('actions 全被禁用时回退到 command（避免整阶段被静默跳过）', () => {
    const got = pickActions({
      actions: [shellAction({ id: 'a1', enabled: false })],
      command: 'fallback',
    });
    expect(got).toHaveLength(1);
    expect(got[0].code).toBe('fallback');
  });
});

describe('validateActions（操作序列校验）', () => {
  it('合法序列无错误', () => {
    expect(
      validateActions([
        shellAction({ id: 'a1' }),
        { id: 'a2', type: 'service', name: '引用工具', tool: 'git-pull' },
      ]),
    ).toEqual([]);
  });

  it('缺少 id / 名称时报错', () => {
    const errs = validateActions([
      shellAction({ id: '' }),
      shellAction({ id: 'a2', name: '  ' }),
    ]);
    expect(errs.some((e) => e.includes('缺少 id'))).toBe(true);
    expect(errs.some((e) => e.includes('缺少名称'))).toBe(true);
  });

  it('id 重复时报错（否则日志无法区分是哪个操作失败）', () => {
    const errs = validateActions([
      shellAction({ id: 'a1' }),
      shellAction({ id: 'a1', name: '第二个' }),
    ]);
    expect(errs.some((e) => e.includes('id 重复'))).toBe(true);
  });

  it('shell 缺脚本 / service 缺工具 code 时报错', () => {
    const errs = validateActions([
      shellAction({ id: 'a1', code: '  ' }),
      { id: 'a2', type: 'service', name: '无工具' },
    ]);
    expect(errs.some((e) => e.includes('shell 操作缺少脚本'))).toBe(true);
    expect(errs.some((e) => e.includes('缺少工具 code'))).toBe(true);
  });

  it('未知操作类型时报错', () => {
    const errs = validateActions([shellAction({ id: 'a1', type: 'docker' as never })]);
    expect(errs.some((e) => e.includes('未知操作类型'))).toBe(true);
  });
});
