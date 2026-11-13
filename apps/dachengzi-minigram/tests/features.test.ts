/**
 * utils/features.ts 单测（功能注册表 + 常用功能收藏）。
 *
 * 口径（specs/dachengzi-minigram/review-remove-ai-2026-11-13.md §4.4）：
 * storage key = feature_pinned（JSON 数组），无值回退 defaultPinned 集合（仅 nce）；
 * 变更后经 app.eventBus 广播 features:updated。
 */
export {};

const store = new Map<string, unknown>();

const wxMock = {
  getStorageSync: jest.fn((k: string) => (store.has(k) ? store.get(k) : '')),
  setStorageSync: jest.fn((k: string, v: unknown) => {
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
const features = require('../utils/features') as typeof import('../utils/features');

describe('FEATURES 注册表', () => {
  it('含 nce + glossary 两项，nce defaultPinned、glossary 非 defaultPinned', () => {
    expect(features.FEATURES.map((f) => f.id)).toEqual(['nce', 'glossary']);
    const nce = features.FEATURES.find((f) => f.id === 'nce')!;
    const glossary = features.FEATURES.find((f) => f.id === 'glossary')!;
    expect(nce.defaultPinned).toBe(true);
    expect(glossary.defaultPinned).toBe(false);
    expect(glossary.needLogin).toBe(true);
  });
});

describe('getPinned（无值回退 defaultPinned 集合）', () => {
  it('新装无任何存储：回退默认，仅 nce', () => {
    expect(features.getPinned()).toEqual(['nce']);
  });

  it('存储为合法 string 数组 → 原样返回', () => {
    store.set('feature_pinned', ['nce', 'glossary']);
    expect(features.getPinned()).toEqual(['nce', 'glossary']);
  });

  it('存储为空数组 → 空数组（不回退默认，用户主动全取消）', () => {
    store.set('feature_pinned', []);
    expect(features.getPinned()).toEqual([]);
  });

  it('存储非法（非数组 / 非字符串元素）→ 回退默认', () => {
    store.set('feature_pinned', 'garbage');
    expect(features.getPinned()).toEqual(['nce']);
    store.set('feature_pinned', [1, 2, 3]);
    expect(features.getPinned()).toEqual(['nce']);
  });

  it('读存储抛异常 → 回退默认，不上抛', () => {
    wxMock.getStorageSync.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(features.getPinned()).toEqual(['nce']);
  });
});

describe('isPinned', () => {
  it('默认态：nce 已常驻、glossary 未常驻', () => {
    expect(features.isPinned('nce')).toBe(true);
    expect(features.isPinned('glossary')).toBe(false);
  });
});

describe('togglePinned（写 storage + 广播 features:updated）', () => {
  it('加入 glossary：写盘 + 广播最新列表', () => {
    const next = features.togglePinned('glossary');
    expect(next).toEqual(['nce', 'glossary']);
    expect(wxMock.setStorageSync).toHaveBeenCalledWith('feature_pinned', ['nce', 'glossary']);
    expect(bus.emit).toHaveBeenCalledWith('features:updated', ['nce', 'glossary']);
  });

  it('取消 nce：写盘 + 广播空列表', () => {
    const next = features.togglePinned('nce');
    expect(next).toEqual([]);
    expect(wxMock.setStorageSync).toHaveBeenCalledWith('feature_pinned', []);
  });

  it('getApp 不可用（极早期/异常）：仍写存储、不崩溃', () => {
    (globalThis as any).getApp = jest.fn(() => {
      throw new Error('no app');
    });
    expect(() => features.togglePinned('glossary')).not.toThrow();
    expect(features.isPinned('glossary')).toBe(true);
  });
});
