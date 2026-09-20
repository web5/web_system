import { evalCondition, validateCondition } from './condition';

describe('条件表达式引擎（步骤执行条件 / 任务匹配条件共用）', () => {
  it('== / != 基本判断', () => {
    expect(evalCondition('DEPLOY_ENV == prod', { DEPLOY_ENV: 'prod' })).toBe(true);
    expect(evalCondition('DEPLOY_ENV == prod', { DEPLOY_ENV: 'local' })).toBe(false);
    expect(evalCondition('DEPLOY_ENV != local', { DEPLOY_ENV: 'dev' })).toBe(true);
    expect(evalCondition('DEPLOY_ENV != local', { DEPLOY_ENV: 'local' })).toBe(false);
  });

  it('&& 多条件：全部为真才为真', () => {
    expect(evalCondition('DEPLOY_ENV == prod && MODULE_TYPE == backend', { DEPLOY_ENV: 'prod', MODULE_TYPE: 'backend' })).toBe(true);
    expect(evalCondition('DEPLOY_ENV == prod && MODULE_TYPE == backend', { DEPLOY_ENV: 'prod', MODULE_TYPE: 'frontend' })).toBe(false);
  });

  it('空表达式 = 无条件，恒真（默认任务）', () => {
    expect(evalCondition('', {})).toBe(true);
    expect(evalCondition(null, {})).toBe(true);
  });

  it('变量缺失视为空串（!= 成立、== 不成立）', () => {
    expect(evalCondition('DEPLOY_ENV != prod', {})).toBe(true);
    expect(evalCondition('DEPLOY_ENV == prod', {})).toBe(false);
  });

  it('带空格的值用引号包裹', () => {
    expect(evalCondition(`NAME == 'a b'`, { NAME: 'a b' })).toBe(true);
    expect(evalCondition(`NAME == "Release bot"`, { NAME: 'Release bot' })).toBe(true);
  });

  it('非法表达式：校验给出可展示原因', () => {
    expect(validateCondition('DEPLOY_ENV')).toMatchObject({ ok: false });
    expect(validateCondition('DEPLOY_ENV = prod').ok).toBe(false);
    expect(validateCondition('9BAD == prod').ok).toBe(false);
    expect(validateCondition(`DEPLOY_ENV == '未闭合`).ok).toBe(false);
    expect(validateCondition('DEPLOY_ENV == prod &&').ok).toBe(false);
    expect(validateCondition('DEPLOY_ENV == prod && MODULE_TYPE == a b').ok).toBe(false);
  });

  it('空/合法表达式校验通过', () => {
    expect(validateCondition('').ok).toBe(true);
    expect(validateCondition('DEPLOY_ENV == local').ok).toBe(true);
    expect(validateCondition('DEPLOY_ENV != prod && BRANCH == master').ok).toBe(true);
  });

  it('运行期非法表达式直接抛错（fail-fast，不静默放行）', () => {
    expect(() => evalCondition('DEPLOY_ENV', { DEPLOY_ENV: 'prod' })).toThrow(/执行条件非法/);
  });

  it('数值型变量按字符串比较（避免类型隐式转换陷阱）', () => {
    expect(evalCondition('PORT == 6004', { PORT: 6004 })).toBe(true);
    expect(evalCondition('PORT == 6004', { PORT: '6004' })).toBe(true);
  });
});
