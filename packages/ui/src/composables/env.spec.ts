import { resolveEnvId, ENV_STORAGE_KEY, readManifest } from './env';

/**
 * 环境解析单测（P3 · 前端侧语义）
 *
 * 必须与 gateway 侧 `resolveEnvId`（dynamic-route/route-match.ts）保持同一优先级：
 *   ① 用户在挂件里选的（localStorage）
 *   ② 站点默认环境（defaultEnv）
 *   ③ 'dev'（Q1：找不到一律回退主开发环境）
 *
 * 两个高频事故场景用断言锁死：
 * - 环境被删除后 localStorage 残留旧值 → 必须回退，不能继续指向已删目录；
 * - gateway 未产出 envs（旧结构）→ 不因列表为空而丢弃用户选择。
 */

function setStored(value: string | null): void {
  const store = new Map<string, string>();
  if (value !== null) store.set(ENV_STORAGE_KEY, value);
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

describe('resolveEnvId（前端侧环境解析）', () => {
  const envs = [
    { id: 'dev', name: '主开发环境' },
    { id: '1', name: '联调环境' },
    { id: '2', name: '灰度验证' },
  ];

  it('localStorage 优先（用户在挂件里选过）', () => {
    setStored('2');
    expect(resolveEnvId({ envs, defaultEnv: 'dev' })).toBe('2');
  });

  it('未选择时回落到站点默认环境', () => {
    setStored(null);
    expect(resolveEnvId({ envs, defaultEnv: '1' })).toBe('1');
  });

  it('无 defaultEnv 时用旧 env 字段，最后回退 dev（Q1）', () => {
    setStored(null);
    expect(resolveEnvId({ envs, env: '1' })).toBe('1');
    expect(resolveEnvId({ envs })).toBe('dev');
    expect(resolveEnvId()).toBe('dev');
  });

  it('环境被删除后 localStorage 残留旧值 → 回退默认环境（不能指向已删目录）', () => {
    setStored('9'); // 环境 9 已不存在
    expect(resolveEnvId({ envs, defaultEnv: 'dev' })).toBe('dev');
  });

  it('默认环境不在 envs 列表时，取列表中第一个（兜底而非硬编码 dev）', () => {
    setStored(null);
    expect(resolveEnvId({ envs, defaultEnv: 'gone' })).toBe('dev');
    expect(resolveEnvId({ envs: [{ id: '1' }], defaultEnv: 'gone' })).toBe('1');
  });

  it('gateway 未产出 envs（旧结构）时仍尊重用户选择（不因列表为空丢弃）', () => {
    setStored('1');
    expect(resolveEnvId({ env: 'dev' })).toBe('1');
  });
});

describe('readManifest（注入读取）', () => {
  it('未注入时返回空对象（不抛异常）', () => {
    expect(readManifest()).toEqual({});
  });

  it('能读到注入的 manifest', () => {
    (globalThis as any).__MODULES_MANIFEST__ = { site: 'dev', envs: [{ id: 'dev' }] };
    expect(readManifest().site).toBe('dev');
    delete (globalThis as any).__MODULES_MANIFEST__;
  });
});
