import { describe, it, expect, vi, afterEach } from 'vitest';
import { WIDGET_NAMESPACE } from '../lib/widget-protocol';
import { System, WIDGET_BASE } from './system-loader';

// 与 public/mf-widgets/*.system.js 完全同形的 System.register 载荷
// （真实产物：System.register(["vue","agui-bus"], function(exports, module){ return {setters, execute} })）
const BUNDLE = `
System.register(["vue", "agui-bus"], function(exports, module) {
  "use strict";
  var createApp, aguiBus;
  return {
    setters: [
      function(m) { createApp = m.createApp; },
      function(b) { aguiBus = b.aguiBus; }
    ],
    execute: function() {
      exports("mount", function(container, props, ctx) {
        return {
          tag: createApp,
          bus: aguiBus,
          props: props,
          slotId: ctx.slotId,
          unmount: function() {}
        };
      });
    }
  };
});
`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('精简 System.register 运行时', () => {
  it(`按 app 名解析为 ${WIDGET_BASE}/<app>.system.js`, () => {
    expect(System.resolve(`${WIDGET_NAMESPACE}/poll`)).toBe(`${WIDGET_BASE}/poll.system.js`);
    expect(System.resolve(`${WIDGET_NAMESPACE}/chart`)).toBe(`${WIDGET_BASE}/chart.system.js`);
    expect(System.resolve('vue')).toBe('vue');
  });

  it('register -> setters 拿到基座 vue/agui-bus 单例 -> execute 导出 mount', async () => {
    const vueSingleton = { createApp: 'VUE_SINGLETON' };
    const busSingleton = { aguiBus: 'BUS_SINGLETON' };
    System.set('vue', vueSingleton as unknown as Record<string, unknown>);
    System.set('agui-bus', busSingleton as unknown as Record<string, unknown>);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => BUNDLE })),
    );

    const ns = await System.import(`${WIDGET_NAMESPACE}/loader-probe`);
    expect(typeof (ns.mount as unknown)).toBe('function');

    const def = System.definitionOf(`${WIDGET_NAMESPACE}/loader-probe`);
    expect(def?.deps).toEqual(['vue', 'agui-bus']);

    const handle = (ns.mount as unknown as (c: unknown, p: unknown, x: unknown) => Record<string, unknown>)(
      {},
      { question: 'q' },
      { slotId: 'slot-1' },
    );
    expect(handle.tag).toBe('VUE_SINGLETON');
    expect(handle.bus).toBe('BUS_SINGLETON');
    expect(handle.slotId).toBe('slot-1');
    expect(handle.props).toEqual({ question: 'q' });
  });

  it('同一 URL 重复 import 只 fetch 一次（模块实例缓存）', async () => {
    System.set('vue', { createApp: 'X' } as unknown as Record<string, unknown>);
    System.set('agui-bus', { aguiBus: 'Y' } as unknown as Record<string, unknown>);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => BUNDLE }));
    vi.stubGlobal('fetch', fetchMock);

    const a = await System.import(`${WIDGET_NAMESPACE}/cache-probe`);
    const b = await System.import(`${WIDGET_NAMESPACE}/cache-probe`);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('非 System.register 产物报错，不静默吞掉', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => 'renderWidget(1)' })),
    );
    await expect(System.import(`${WIDGET_NAMESPACE}/broken-probe`)).rejects.toThrow(/不是 System.register/);
  });
});
