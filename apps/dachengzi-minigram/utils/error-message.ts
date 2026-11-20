/**
 * 错误文案归一化 —— 全仓唯一真相源（2026-11-20 治本 · 依据 49 §5 方案 B）。
 *
 * 背景：NestJS ValidationPipe（whitelist / forbidNonWhitelisted）对参数校验失败返回
 *   HTTP 400 + { statusCode, message: string[], error }，message 是 class-validator 数组；
 *   ai-agent 的 UnifiedExceptionFilter 也可能给出对象 / 其它形态。
 *   @types/wechat-miniprogram@3.4.10 的 ShowToastOption.title 是 string（lib.wx.api.d.ts:5843），
 *   把数组 / 对象直接传给 wx.showToast 会让提示静默或抛错（30 号定案）。
 *
 * 为何独立成 utils/ 叶子模块，而非放进 utils/request.ts 内部：
 *   1. services/account.ts 的 readMessage(err, fallback)（上传头像链路，:238-244）也委托本函数，
 *      两处共用一份归一化，杜绝「同款逻辑两处漂移」；
 *   2. request.ts 依赖 wx / token / loginEnsurer 等网络语义，且按既有设计（:99-114）
 *      不得 import services/*（避免 request↔auth 循环）；独立纯函数模块不含任何 import，
 *      依赖图无环：error-message.ts ← request.ts、account.ts；
 *   3. 归一化与「发请求」无关，可被未来其它错误展示方复用，也不必拖入整个请求模块的语义。
 *
 * 🔴 契约边界（2026-11-20 lead 选项 2 裁决，依据 V6 门
 *    tests/request-login-timeout.test.ts:111-122，8688 复核人审约束）：
 *    非 silent 且失败 ⇒ 有且仅有一条 string toast；但判据原则是「是否有其它 UI 通道承接」，
 *    不是「是否 throw」。本函数只负责「已进入统一失败提示」那部分 message 的归一化：
 *      - url 非法 / 应用未初始化：无任何 UI 承接 ⇒ 必弹且 string（rawMessage 为 undefined
 *        时经本函数回落 fallback「网络异常，请重试」）；
 *      - 「!token → NOT_LOGGED_IN」是登录态信号，由 login-gate / modal-login 专门 UI 承接
 *        ⇒ utils/request.ts 顶层唯一出口对这条路径不调用 notifyFailure / 本函数
 *        （51 §4 D1：改顶层单一出口后唯一出口仍在 request() 顶层 catch），
 *        页面层与请求层都不弹。
 *    这是刻意例外，不是遗漏：切勿把 NOT_LOGGED_IN 也拉进统一提示来「补」这个边界。
 */

/**
 * 把任意形态的服务端 message 归一化为可安全传给 wx.showToast({ title }) 的 string。
 * - 数组（class-validator）→ 首项做**类型判断**（51 §4 D5 订正）：
 *     · string → 原值（空串回落 fallback）
 *     · number → 十进制字符串（如 123 → "123"）
 *     · 对象 / 数组 / undefined / null / 布尔 / 其它 → fallback
 *   旧写法 String(m[0] || fallback) 在首项为对象时会产出不可读的 "[object Object]"；
 *   虽仍是 string、符合旧公式，但用户看到的是无意义文案 —— 此处按「可读性」收紧。
 * - string → 原值（空串回落 fallback）
 * - 对象 / undefined / null / 数字 / 布尔 / 其它 → fallback
 * 恒返回 string，绝不把数组 / 对象透出，且保证文案可读。
 */
export function normalizeMessage(message: unknown, fallback: string): string {
  if (Array.isArray(message)) {
    const first = message[0];
    if (typeof first === 'string') return first || fallback;
    if (typeof first === 'number') return String(first);
    return fallback;
  }
  if (typeof message === 'string') return message || fallback;
  return fallback;
}
