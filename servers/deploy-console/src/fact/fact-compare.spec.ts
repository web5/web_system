import { classifyFact } from './fact-compare';

describe('事实状态判定', () => {
  it('有期望且一致 → ok', () => {
    expect(classifyFact({ expected: '5ba74517', actual: '5ba74517' })).toEqual({
      status: 'ok',
      expected: '5ba74517',
      actual: '5ba74517',
    });
  });

  it('有期望但不一致 → drift', () => {
    expect(classifyFact({ expected: '5ba74517', actual: '69d9e5f9' }).status).toBe('drift');
  });

  it('有期望但没采到 → missing（不是 ok，也不是 error）', () => {
    expect(classifyFact({ expected: 'online', actual: null }).status).toBe('missing');
  });

  it('采到了但没有期望态 → unknown（不许算进 ok，否则数字永远好看）', () => {
    expect(classifyFact({ expected: null, actual: '5ba74517' }).status).toBe('unknown');
  });

  it('都没有 → unknown', () => {
    expect(classifyFact({ expected: undefined, actual: undefined }).status).toBe('unknown');
  });

  it('支持自定义相等判定（数值/集合类事实）', () => {
    const equals = (a: string, b: string) => Number(a) === Number(b);
    expect(classifyFact({ expected: '6000', actual: '6000.0', equals }).status).toBe('ok');
  });
});
