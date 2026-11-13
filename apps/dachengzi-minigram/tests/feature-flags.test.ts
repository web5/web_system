/**
 * utils/feature-flags.ts 单测（纯本地功能开关）。
 *
 * 口径（PRD v0.4 §2）：storage key = feature_chat / feature_translate，
 * 值 '1'/'0'；无存储值 = 关（安全侧，新装即审核态）；变更经 app.eventBus 广播 flags:updated。
 */
export {};

const store = new Map<string, string>();

const wxMock = {
  getStorageSync: jest.fn((k: string) => (store.has(k) ? store.get(k) : '')),
  setStorageSync: jest.fn((k: string, v: string) => {
    store.set(k, v);
  }),
  removeStorageSync: jest.fn((k: string) => {
    store.delete(k);
  }),
};

const bus = {
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
};

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).getApp = jest.fn(() => ({ eventBus: bus }));
});

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  (globalThis as any).getApp = jest.fn(() => ({ eventBus: bus }));
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const flags = require('../utils/feature-flags') as typeof import('../utils/feature-flags');

describe('featureEnabled（无存储值 = 关，安全侧）', () => {
  it('新装无任何存储：chat / translate 均为关', () => {
    expect(flags.featureEnabled('chat')).toBe(false);
    expect(flags.featureEnabled('translate')).toBe(false);
  });

  it("存储值为 '1' → 开；'0' → 关；其他非法值 → 关", () => {
    store.set('feature_chat', '1');
    store.set('feature_translate', 'yes');
    expect(flags.featureEnabled('chat')).toBe(true);
    expect(flags.featureEnabled('translate')).toBe(false);
  });

  it('读存储抛异常（如基础库异常）→ 按关处理，不上抛', () => {
    wxMock.getStorageSync.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(flags.featureEnabled('chat')).toBe(false);
  });
});

describe('setFeatureEnabled（写 storage + 广播 flags:updated）', () => {
  it('开启：写入 \'1\' 并广播最新状态', () => {
    flags.setFeatureEnabled('chat', true);
    expect(wxMock.setStorageSync).toHaveBeenCalledWith('feature_chat', '1');
    expect(flags.featureEnabled('chat')).toBe(true);
    expect(bus.emit).toHaveBeenCalledWith('flags:updated', {
      chat: true,
      translate: false,
    });
  });

  it('关闭：写入 \'0\' 并广播', () => {
    flags.setFeatureEnabled('translate', true);
    jest.clearAllMocks();
    flags.setFeatureEnabled('translate', false);
    expect(wxMock.setStorageSync).toHaveBeenCalledWith('feature_translate', '0');
    expect(flags.featureEnabled('translate')).toBe(false);
    expect(bus.emit).toHaveBeenCalledWith('flags:updated', {
      chat: false,
      translate: false,
    });
  });

  it('getApp 不可用（极早期/异常）：仍写存储，不崩溃', () => {
    (globalThis as any).getApp = jest.fn(() => {
      throw new Error('no app');
    });
    expect(() => flags.setFeatureEnabled('chat', true)).not.toThrow();
    expect(flags.featureEnabled('chat')).toBe(true);
  });
});

describe('readFlags（页面渲染取数入口）', () => {
  it('汇总两个开关的当前状态', () => {
    store.set('feature_chat', '1');
    expect(flags.readFlags()).toEqual({ chat: true, translate: false });
  });
});
