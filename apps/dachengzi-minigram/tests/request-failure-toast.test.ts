/**
 * utils/request.ts「失败提示统一契约」单测（2026-11-20 治本 · 依据 49 §5 方案 B / 台账 #8947）。
 * 2026-11-20 二改：51 §4 D1 冻结反例 → 改「顶层单一出口」，新增 ⑧ 回归判据。
 *
 * 行为契约（唯一真相源）：
 *   1. 所有经 utils/request.ts 发出的请求，只要非 silent 且失败，必须有且仅有一条
 *      用户可见 toast，且 title 恒为 string —— 禁止把数组 / 对象直接传给 wx.showToast。
 *      「有且仅有一条」由「request() 顶层 catch 只调用一次 notifyFailure」结构性保证：
 *      doRequest 三条失败路径只 reject，不写任何去重标记、不读 / 写错误对象，
 *      故 Object.freeze / 不可扩展 / Proxy / 原始值 err 天然只弹一次（51 §4 D1）。
 *   2. 错误文案归一化：数组 → 首项做类型判断（string 原值 / number 十进制字符串 /
 *      对象·数组·其它回落 fallback）；string → 原值（空串回落）；对象 / 其它 → fallback。
 *      fallback 口径：HTTP 非 2xx「请求失败 (<statusCode>)」、ai-agent 2xx 错误信封
 *      「请求失败 (<code>)」、fail(err)「网络请求失败」、本地 throw「网络异常，请重试」。
 *   3. 契约边界（2026-11-20 lead 选项 2 裁决 / V6 门 tests/request-login-timeout.test.ts:111-122）：
 *      判据原则是「是否有其它 UI 通道承接」，不是「是否 throw」。url 非法 / 应用未初始化
 *      无 UI 承接 ⇒ 必弹且 string；「!token → NOT_LOGGED_IN」是登录态信号，由 login-gate
 *      承接 ⇒ 页面层与请求层都不弹（刻意例外，见 ③）。
 *
 * 背景：dev 曾返回 POST /glossary → 400，message 是 class-validator 数组
 *   ["property tag should not exist", "sourceType must be one of the following values: ..."]；
 *   旧实现 utils/request.ts:263 把它直接塞进 wx.showToast 的 title
 *   （@types/wechat-miniprogram@3.4.10 lib.wx.api.d.ts:5843 ShowToastOption.title: string），
 *   页面层 detail.ts 又因 hasHttpResponse 放弃兜底 → 全链路静默（49 §3）。
 *   既有 nce-detail-v7c.test.ts:945 把「HTTP 400 不弹」钉成预期，属验收盲区（49 §4）。
 *
 * 51 §4 D1 反例（本单 ⑧ 固化）：旧实现把 __toastShown 写进外部错误对象去重，
 *   Object.freeze(res) 后赋值抛 TypeError 被 try/catch 吞掉，顶层兜底再弹一次 →
 *   showToastCount = 2，违反契约 1。改顶层单一出口后不存在写标记，对照组与冻结组都恰 1 条。
 *
 * 测试形态照 tests/request-envelope.test.ts（本地 mock wx，不拉起开发者工具 / 不跑 E2E）。
 */
import { request, setLoginEnsurer } from '../utils/request';

interface FakeSuccessRes {
  statusCode: number;
  data: unknown;
}

interface WxRequestOpts {
  url?: string;
  success?: (res: FakeSuccessRes) => void;
  fail?: (err: unknown) => void;
}

let capturedSuccess: ((res: FakeSuccessRes) => void) | null = null;
let capturedFail: ((err: unknown) => void) | null = null;
let storage: Record<string, string>;

const busMock = {
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
};

const wxMock = {
  getStorageSync: jest.fn((key: string): unknown => {
    if (key === 'api_base') return storage.api_base ?? 'http://example.com';
    if (key === 'access_token') return storage.access_token ?? 'token-123';
    return undefined;
  }),
  setStorageSync: jest.fn(),
  removeStorageSync: jest.fn(),
  showToast: jest.fn(),
  request: jest.fn((opts: WxRequestOpts) => {
    capturedSuccess = opts.success || null;
    capturedFail = opts.fail || null;
  }),
};

beforeAll(() => {
  (globalThis as unknown as { wx: unknown }).wx = wxMock;
  (globalThis as unknown as { getApp?: unknown }).getApp = () => ({ eventBus: busMock });
});

beforeEach(() => {
  jest.clearAllMocks();
  capturedSuccess = null;
  capturedFail = null;
  storage = { api_base: 'http://example.com', access_token: 'token-123' };
});

function fireSuccess(res: FakeSuccessRes): void {
  expect(capturedSuccess).not.toBeNull();
  capturedSuccess!(res);
}

function fireFail(err: unknown): void {
  expect(capturedFail).not.toBeNull();
  capturedFail!(err);
}

/** 取最后一次 toast 的 title，并断言它恒为 string（契约 1 的核心判据） */
function lastTitle(): string {
  const calls = wxMock.showToast.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  const arg = calls[calls.length - 1][0] as { title: unknown };
  expect(typeof arg.title).toBe('string');
  return arg.title as string;
}

// ═══════════════ ① 400 + 数组 message（dev 真实形态） ═══════════════
describe('① HTTP 非 2xx + 数组 message → 归一化 + 必弹 + 恰 1 条', () => {
  it('400 + data.message 为 class-validator 数组 → toast 恰 1 条，title 为 string 且取数组首条', async () => {
    const p = request({ url: '/api/glossary', method: 'POST', data: { tag: 'nce' } });
    fireSuccess({
      statusCode: 400,
      data: {
        statusCode: 400,
        message: [
          'property tag should not exist',
          'sourceType must be one of the following values: chat, translate',
        ],
        error: 'Bad Request',
      },
    });
    await expect(p).rejects.toBeDefined();

    expect(wxMock.showToast).toHaveBeenCalledTimes(1); // 顶层单一出口：仅顶层 catch 弹一次
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: 'property tag should not exist', icon: 'none' });
    expect(lastTitle()).toBe('property tag should not exist');
    expect(wxMock.removeStorageSync).not.toHaveBeenCalled(); // 非 401 不得清 token
  });

  it('数组首项为空 → 回落 string（不得把 undefined 当 title）', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 400, data: { message: ['', 'second'] } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('请求失败 (400)');
  });
});

// ═══════════════ ② 对象 / 非字符串 message → 回落 string ═══════════════
describe('② 对象 / 数字 / 空串 message → 回落 string，绝不透出非 string', () => {
  it('400 + message 为嵌套对象 → title 回落「请求失败 (400)」', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 400, data: { message: { error: 'Bad Request', statusCode: 400 } } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('请求失败 (400)');
  });

  it('400 + message 为数字 → title 回落「请求失败 (400)」', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 400, data: { message: 12345 } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('请求失败 (400)');
  });

  it('400 + message 为空串 → title 回落「请求失败 (400)」', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 400, data: { message: '' } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('请求失败 (400)');
  });

  it('400 + message 为正常 string → 原值透出（既有行为不变）', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 400, data: { message: '收藏失败，请重试' } });
    await expect(p).rejects.toBeDefined();
    expect(lastTitle()).toBe('收藏失败，请重试');
  });

  it('2xx + ai-agent 错误信封 message 为数组 → 同样归一化为 string', async () => {
    const p = request({ url: '/api/ai-agent/agent/run' });
    fireSuccess({ statusCode: 200, data: { code: 5000, message: ['信封数组首条', '信封数组次条'], data: null } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('信封数组首条');
  });

  it('400 + message 为数组且首项是对象 → 回落 fallback「请求失败 (400)」，绝不产出 "[object Object]"（51 §4 D5）', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 400, data: { message: [{ error: 'Bad Request' }, 'second'] } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    const title = lastTitle();
    expect(typeof title).toBe('string');
    expect(title).toBe('请求失败 (400)');
    expect(title).not.toContain('[object Object]');
  });
});

// ═══════════════ ③ 本地错误（发请求前的 throw 路径）→ 按「是否有其它 UI 通道承接」分流 ═══════════════
// 契约边界（2026-11-20 lead 选项 2 裁决 / V6 门 tests/request-login-timeout.test.ts:111-122）：
//   url 非法 / 应用未初始化 无任何 UI 承接 ⇒ 必弹且 string；
//   NOT_LOGGED_IN 属登录态信号，由 login-gate 承接 ⇒ 页面层与请求层都不弹（刻意例外）。
describe('③ 本地校验 throw：url 非法 / 未初始化 必弹且 string；NOT_LOGGED_IN 登录态静默', () => {
  it('url 非 /api/ 前缀 → 必弹 1 条中文 string（无 UI 承接）', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(request({ url: 'users/me' })).rejects.toThrow(/必须以 \/api\/ 开头/);
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('网络异常，请重试');
    spy.mockRestore();
  });

  it('应用未初始化（无 baseUrl）→ 必弹 1 条中文 string（无 UI 承接）', async () => {
    storage.api_base = '';
    await expect(request({ url: '/api/glossary' })).rejects.toThrow(/应用未初始化/);
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('网络异常，请重试');
  });

  it('NOT_LOGGED_IN（无 token，loginEnsurer 未注入）→ 登录态信号，页面层与请求层都不弹（V6 门）', async () => {
    storage.access_token = '';
    await expect(request({ url: '/api/glossary' })).rejects.toThrow('NOT_LOGGED_IN');
    // 由 login-gate / modal-login 承接；请求层刻意不弹，避免与登录墙重复提示 / 并发刷屏
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });
});

// ═══════════════ ④ silent:true → 完全不弹 ═══════════════
describe('④ silent:true（services/auth.ts:61 登出）→ 不弹任何 toast', () => {
  it('silent + 400 数组 message → 仍 reject，但不弹', async () => {
    const p = request({ url: '/api/auth/logout', method: 'POST', data: {}, silent: true });
    fireSuccess({ statusCode: 400, data: { message: ['x'] } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });

  it('silent + fail(err) → 仍 reject，但不弹', async () => {
    const p = request({ url: '/api/auth/logout', method: 'POST', silent: true });
    fireFail({ errMsg: 'request:fail timeout' });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });

  it('silent + 本地 url 非法 → 仍 throw，但不弹', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(request({ url: 'bad', silent: true })).rejects.toThrow(/必须以 \/api\/ 开头/);
    expect(wxMock.showToast).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ═══════════════ ⑤ 成功 2xx → 不弹 ═══════════════
describe('⑤ 成功路径 → 不弹 toast', () => {
  it('200 正常直返 → resolve，不弹', async () => {
    const p = request<{ ok: boolean }>({ url: '/api/glossary' });
    fireSuccess({ statusCode: 200, data: { ok: true } });
    await expect(p).resolves.toEqual({ ok: true });
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });

  it('201 Created / 204 No Content → resolve，不弹', async () => {
    const p1 = request<{ id: number }>({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 201, data: { id: 7 } });
    await expect(p1).resolves.toEqual({ id: 7 });
    const p2 = request({ url: '/api/glossary', method: 'DELETE' });
    fireSuccess({ statusCode: 204, data: '' });
    await expect(p2).resolves.toBe('');
    expect(wxMock.showToast).not.toHaveBeenCalled();
  });
});

// ═══════════════ ⑥ 周边行为不变（401 / ai-agent 4010 / fail / 304） ═══════════════
describe('⑥ 既有周边行为不变', () => {
  it('304 Not Modified（data 空串）→ 1 条「请求失败 (304)」string', async () => {
    const p = request({ url: '/api/glossary' });
    fireSuccess({ statusCode: 304, data: '' });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '请求失败 (304)', icon: 'none' });
    expect(lastTitle()).toBe('请求失败 (304)');
  });

  it('2xx + ai-agent 错误信封 code!==0 且 message 为 string → 1 条原值 string（既有 :84 口径）', async () => {
    const p = request({ url: '/api/ai-agent/agent/run' });
    fireSuccess({ statusCode: 200, data: { code: 5000, message: '内部错误', data: null } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '内部错误', icon: 'none' });
  });

  it('2xx + ai-agent 4010 信封 → 清 token + 广播 auth:expired + reject（不弹通用失败 toast）', async () => {
    const p = request({ url: '/api/ai-agent/agent/conversations' });
    fireSuccess({ statusCode: 200, data: { code: 4010, message: 'Authorization header missing', data: null } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('access_token');
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('refresh_token');
    expect(busMock.emit).toHaveBeenCalledWith('auth:expired');
    // 401 授权链由 handleUnauthorized 负责提示（非 silent 时恰好 1 条），不得叠加通用失败 toast
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '登录已过期，请重新登录', icon: 'none' });
  });

  it('HTTP 401 → handleUnauthorized 授权提示 1 条，不弹「网络异常」兜底', async () => {
    const p = request({ url: '/api/glossary' });
    fireSuccess({ statusCode: 401, data: { message: 'Unauthorized' } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('access_token');
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(wxMock.showToast).not.toHaveBeenCalledWith({ title: '网络异常，请重试', icon: 'none' });
  });

  it('fail(err) 网络兜底 → 恰好 1 条「网络请求失败」string', async () => {
    const p = request({ url: '/api/glossary' });
    fireFail({ errMsg: 'request:fail timeout' });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '网络请求失败', icon: 'none' });
    expect(lastTitle()).toBe('网络请求失败');
  });
});

// ═══════════════ ⑦ 顶层单一出口：不写错误对象内部状态 ═══════════════
describe('⑦ 顶层单一出口：失败提示只在 request() 顶层 catch 发生一次，不污染 err', () => {
  it('非 2xx 失败只弹 1 条，reject 的 err 保持原始形态（不挂任何去重标记）', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 400, data: { message: ['a', 'b'] } });
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeDefined();
    // 不得改变 reject 的错误对象形态：statusCode / message 原样透出，供上层与既有测试依赖。
    expect((err as { statusCode?: number }).statusCode).toBe(400);
    // 顶层单一出口不依赖「往错误对象写 __toastShown」；若有人把旧的去重补丁做健壮写回来，
    // 这条会 FAIL（防复发护栏）。冻结 / Proxy / 原始值 err 天然只弹一次，见 ⑧。
    expect((err as Record<string, unknown>).__toastShown).toBeUndefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('a');
  });

  it('本地 throw 也只弹 1 条，且不往 Error 写标记', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = await request({ url: 'bad' }).catch((e: unknown) => e);
    expect((err as Record<string, unknown>).__toastShown).toBeUndefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('网络异常，请重试');
    spy.mockRestore();
  });
});

// ═══════════════ ⑧ 冻结 / 不可扩展错误对象（51 §4 D1 反例固化为正式判据） ═══════════════
// 51 独立复核证伪了旧实现「__toastShown 写标记去重」：Object.freeze(res) 后写标记抛
// TypeError 被 try/catch 吞掉，顶层兜底再弹一次 → showToastCount=2，违反「有且仅有一条」。
// 顶层单一出口天然不依赖 err 可扩展：可读不可写、Proxy、原始值 err 都恰 1 条。
describe('⑧ 冻结 / 不可扩展错误对象 → 仍恰 1 条（51 §4 D1 反例回归）', () => {
  it('可扩展 400 res → 恰 1 条 string toast（对照组）', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 400, data: { message: ['property tag should not exist'] } });
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    const arg = wxMock.showToast.mock.calls[0][0] as { title: unknown };
    expect(typeof arg.title).toBe('string');
    expect(lastTitle()).toBe('property tag should not exist');
  });

  it('Object.freeze(res) 的 400 → 仍恰 1 条 string toast（不依赖写标记）', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    // 浅冻结 res 本身即可复现 51 §4 D1：旧实现把 __toastShown 写在 res 上会抛 TypeError。
    const frozen = Object.freeze({
      statusCode: 400,
      data: { message: ['property tag should not exist'] },
    }) as FakeSuccessRes;
    fireSuccess(frozen);
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    const arg = wxMock.showToast.mock.calls[0][0] as { title: unknown };
    expect(typeof arg.title).toBe('string');
    expect(lastTitle()).toBe('property tag should not exist');
  });
});

// ═══════════════ ⑨ #8949 冻结 / 不可扩展 / Proxy 的 401 与 4010（58 §4.1） ═══════════════
// 根因（58 §2）：doRequest 的 success 回调把「未授权」信号用 Object.assign 写进外部
//   传入的 res；frozen / preventExtensions / set 抛错 Proxy 下赋值抛 TypeError，异常
//   发生在 wx 异步回调栈、脱离 Promise executor 的隐式保护 ⇒ reject 从未执行，promise
//   永久 PENDING + 0 条 toast + 页面永久骨架屏。get 抛错 Proxy 在读取 res.statusCode
//   阶段就抛，是同一条链更前一环。父版 21a96f99 与 fdc4d525 同态，属既有缺陷。
// 方案 R（58 §3）：两处信号改由本地新建对象承载 reject({ ...res, __unauthorized: true })，
//   外部 res 只读摊平、绝不写入；success 整体包 try/catch(e){ reject(e) } 作为 settle
//   边界（异常原样转 reject、绝不吞）。顶层 :336 / :376 判据与 handleUnauthorized 一字不动。
// 🔴 每条断言同时钉 5 个维度（58 §4.1）：settle 状态 + toast 计数 + toast 文案 +
//   removeStorageSync(access_token) + busMock.emit('auth:expired')。只钉计数会让 §4.3 的
//   M3「丢 __unauthorized 信号」假绿（计数仍恰 1 条，文案 / 清 token / 广播全丢）。
// 🔴 复用现有【同步】fireSuccess：旧实现下 Object.assign 抛 TypeError 会冒泡到调用处，
//   故用 expect(() => fireSuccess(res)).not.toThrow() 直接判红（不把 mock 改成异步触发，
//   避免动 ①-⑧ 的时序假设）。「永久 PENDING」的严格实证由 /tmp harness 异步触发承担。
describe('⑨ #8949 冻结 / 不可扩展 / Proxy 的 401 与 4010 → 必 settle 且信号不丢', () => {
  /** 模块级 loginEnsurer 单例复位为「未注入」初始态（内部变量本就是 X|null，导出 API 只收函数） */
  const resetEnsurer = (): void => {
    setLoginEnsurer(null as unknown as () => Promise<boolean>);
  };

  beforeEach(() => {
    resetEnsurer();
    jest.useRealTimers();
  });

  afterEach(() => {
    resetEnsurer();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** 冻结的 HTTP 401 响应（#8949 触发输入） */
  const frozen401 = (): FakeSuccessRes =>
    Object.freeze({ statusCode: 401, data: { message: 'Unauthorized' } }) as FakeSuccessRes;

  /** 冻结的 ai-agent 4010 错误信封（HTTP 200 + code 4010） */
  const frozen4010 = (): FakeSuccessRes =>
    Object.freeze({
      statusCode: 200,
      data: Object.freeze({ code: 4010, message: 'Authorization header missing', data: null }),
    }) as FakeSuccessRes;

  /** settle 探针：200ms 内未 settle 即判 PENDING；用后 clearTimeout，零悬挂 handle */
  const assertSettled = async (p: Promise<unknown>): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const state = await Promise.race([
      p.then(() => 'SETTLED', () => 'SETTLED'),
      new Promise<string>((r) => {
        timer = setTimeout(() => r('PENDING'), 200);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    expect(state).toBe('SETTLED');
  };

  /** 五维授权断言（非 silent 的 401/4010）：计数 / 文案 / 清 token / 广播 / 不叠加通用 */
  const expectUnauthorized = (): void => {
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '登录已过期，请重新登录', icon: 'none' });
    expect(lastTitle()).toBe('登录已过期，请重新登录');
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('access_token');
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('refresh_token');
    expect(busMock.emit).toHaveBeenCalledWith('auth:expired');
    // 授权链不得叠加通用失败 toast：顶层唯一出口靠 __unauthorized 排除判据跳过
    expect(wxMock.showToast).not.toHaveBeenCalledWith({ title: '请求失败 (401)', icon: 'none' });
    expect(wxMock.showToast).not.toHaveBeenCalledWith({ title: '网络异常，请重试', icon: 'none' });
  };

  it('⑨-1 可扩展 401（对照组）→ rejects + 五维授权断言全绿', async () => {
    const p = request({ url: '/api/glossary' });
    expect(() => fireSuccess({ statusCode: 401, data: { message: 'Unauthorized' } })).not.toThrow();
    await assertSettled(p);
    await expect(p).rejects.toBeDefined();
    expectUnauthorized();
  });

  it('⑨-2 Object.freeze(res) 的 401 → 不抛 + 必 settle + 五维授权断言 + 外部 res 未被写入', async () => {
    const p = request({ url: '/api/glossary' });
    const res = frozen401();
    expect(() => fireSuccess(res)).not.toThrow();
    await assertSettled(p);
    await expect(p).rejects.toBeDefined();
    expectUnauthorized();
    // R1 的本质：信号在新对象上，外部冻结 res 绝不带 __unauthorized
    expect(Object.prototype.hasOwnProperty.call(res, '__unauthorized')).toBe(false);
  });

  it('⑨-3 Object.preventExtensions(res) 的 401 → 不抛 + 必 settle + 五维授权断言', async () => {
    const p = request({ url: '/api/glossary' });
    const res = Object.preventExtensions({
      statusCode: 401,
      data: { message: 'Unauthorized' },
    }) as FakeSuccessRes;
    expect(() => fireSuccess(res)).not.toThrow();
    await assertSettled(p);
    await expect(p).rejects.toBeDefined();
    expectUnauthorized();
    expect(Object.prototype.hasOwnProperty.call(res, '__unauthorized')).toBe(false);
  });

  it('⑨-4 Object.freeze 的 ai-agent 4010 信封 → 不抛 + 必 settle + 五维授权断言', async () => {
    const p = request({ url: '/api/ai-agent/agent/conversations' });
    const res = frozen4010();
    expect(() => fireSuccess(res)).not.toThrow();
    await assertSettled(p);
    await expect(p).rejects.toBeDefined();
    expectUnauthorized();
    expect(Object.prototype.hasOwnProperty.call(res, '__unauthorized')).toBe(false);
  });

  it('⑨-5 Proxy set/defineProperty 抛错的 401 → 不抛 + 必 settle + 五维授权断言', async () => {
    const p = request({ url: '/api/glossary' });
    const res = new Proxy(
      { statusCode: 401, data: { message: 'Unauthorized' } },
      {
        set() {
          throw new TypeError('proxy set forbidden');
        },
        defineProperty() {
          throw new TypeError('proxy defineProperty forbidden');
        },
      },
    ) as FakeSuccessRes;
    expect(() => fireSuccess(res)).not.toThrow();
    await assertSettled(p);
    await expect(p).rejects.toBeDefined();
    expectUnauthorized();
  });

  it('⑨-6 Proxy get 抛错的 401 → 不抛 + 必 settle + 恰 1 条通用 toast + 不误走授权（有意行为变化）', async () => {
    const p = request({ url: '/api/glossary' });
    const res = new Proxy(
      { statusCode: 401, data: { message: 'Unauthorized' } },
      {
        get() {
          throw new TypeError('proxy get forbidden');
        },
      },
    ) as FakeSuccessRes;
    expect(() => fireSuccess(res)).not.toThrow();
    await assertSettled(p);
    await expect(p).rejects.toBeDefined();
    // 该输入在读取阶段就抛错、无法识别为 401；R2 边界原样转 reject，顶层唯一出口
    // 降级为 1 条通用失败 toast（title 恒 string）—— 从「0 条 + 永久 PENDING」变为
    // 「1 条 + REJECTED」，符合「非 silent 失败恰 1 条」契约，属有意的行为变化。
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('网络异常，请重试');
    expect(wxMock.showToast).not.toHaveBeenCalledWith({ title: '登录已过期，请重新登录', icon: 'none' });
    expect(wxMock.removeStorageSync).not.toHaveBeenCalled();
    expect(busMock.emit).not.toHaveBeenCalled();
  });

  it('⑨-7 冻结 401 + silent:true → 不抛 + 必 settle + 0 条 toast + 仍清 token + 不广播', async () => {
    const p = request({ url: '/api/glossary', silent: true });
    const res = frozen401();
    expect(() => fireSuccess(res)).not.toThrow();
    await assertSettled(p);
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).not.toHaveBeenCalled();
    // silent 只关提示，不关清 token：handleUnauthorized 的 clearToken 在 silent 判断之外
    expect(wxMock.removeStorageSync).toHaveBeenCalledWith('access_token');
    expect(busMock.emit).not.toHaveBeenCalled();
  });

  it('⑨-8 冻结 401 + 静默重登成功 → 用新 token 重试并 resolve，0 条 toast', async () => {
    // fake timers 只为收掉 request.ts 内层 Promise.race 的 5s 兜底 timer（不改该源码）
    jest.useFakeTimers();
    try {
      setLoginEnsurer(async () => {
        storage.access_token = 'tk-new';
        return true;
      });
      const p = request<{ ok: boolean }>({ url: '/api/glossary' });
      expect(() => fireSuccess(frozen401())).not.toThrow();
      // 等 401 重登链路把第二次 wx.request 发出（纯微任务链，不依赖 timer）
      for (let i = 0; i < 50 && wxMock.request.mock.calls.length < 2; i++) {
        await Promise.resolve();
      }
      expect(wxMock.request).toHaveBeenCalledTimes(2);
      const secondOpts = wxMock.request.mock.calls[1][0] as unknown as { header?: Record<string, string> };
      expect(secondOpts.header?.Authorization).toBe('Bearer tk-new');
      // 第二次请求成功 → 整体 resolve
      fireSuccess({ statusCode: 200, data: { ok: true } });
      await expect(p).resolves.toEqual({ ok: true });
      expect(wxMock.showToast).not.toHaveBeenCalled();
      expect(wxMock.removeStorageSync).not.toHaveBeenCalled();
      expect(busMock.emit).not.toHaveBeenCalled();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('⑨-9 冻结 401 + 静默重登失败 → rejects + 五维授权断言', async () => {
    jest.useFakeTimers();
    try {
      setLoginEnsurer(async () => false);
      const p = request({ url: '/api/glossary' });
      expect(() => fireSuccess(frozen401())).not.toThrow();
      await expect(p).rejects.toBeDefined();
      expectUnauthorized();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it('⑨-10a 冻结 400 → 恰 1 条 + 不清 token + 不广播（非 401 不回归）', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    const res = Object.freeze({
      statusCode: 400,
      data: { message: ['property tag should not exist'] },
    }) as FakeSuccessRes;
    expect(() => fireSuccess(res)).not.toThrow();
    await assertSettled(p);
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('property tag should not exist');
    expect(wxMock.removeStorageSync).not.toHaveBeenCalled();
    expect(busMock.emit).not.toHaveBeenCalled();
  });

  it('⑨-10b fail(err) → 恰 1 条「网络请求失败」+ 不清 token + 不广播（非 401 不回归）', async () => {
    const p = request({ url: '/api/glossary' });
    fireFail({ errMsg: 'request:fail timeout' });
    await assertSettled(p);
    await expect(p).rejects.toBeDefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
    expect(lastTitle()).toBe('网络请求失败');
    expect(wxMock.removeStorageSync).not.toHaveBeenCalled();
    expect(busMock.emit).not.toHaveBeenCalled();
  });

  it('⑨-11a NOT_LOGGED_IN → 静默（0 条）+ 不清 token + 不广播（V6 门不回归）', async () => {
    storage.access_token = '';
    await expect(request({ url: '/api/glossary' })).rejects.toThrow('NOT_LOGGED_IN');
    expect(wxMock.showToast).not.toHaveBeenCalled();
    expect(wxMock.removeStorageSync).not.toHaveBeenCalled();
    expect(busMock.emit).not.toHaveBeenCalled();
  });

  it('⑨-11b 非 401 的 reject 形态不回归：statusCode / data 原样、无去重与未授权标记', async () => {
    const p = request({ url: '/api/glossary', method: 'POST' });
    fireSuccess({ statusCode: 400, data: { message: ['a', 'b'] } });
    const err = (await p.catch((e: unknown) => e)) as Record<string, unknown>;
    expect(err.statusCode).toBe(400);
    expect((err.data as { message: string[] }).message).toEqual(['a', 'b']);
    expect(err.__toastShown).toBeUndefined();
    expect(err.__unauthorized).toBeUndefined();
    expect(wxMock.showToast).toHaveBeenCalledTimes(1);
  });
});
