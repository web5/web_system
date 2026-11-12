/**
 * 本地功能开关（纯本地存储，零后端）。
 *
 * 设计凭证：AiWorkspace/30-任务产物/2026-11-12-小程序AI功能隐藏与远端开关/01-PRD-功能隐藏与远端开关.md v0.2 §2
 *
 * 判定口径（单条件，无远端层）：
 *   featureEnabled(f) = storage[feature_<f>] === '1'   // 无存储值 = 关（安全侧，新装即审核态）
 *
 * - 卸载重装 / 清除缓存 → 存储清空 → 自动回到全关安全态；
 * - 关闭功能仅隐藏入口，不清除该功能的历史数据（对话/翻译记录保留）；
 * - 变更后通过 app.eventBus 广播 `flags:updated`，首页/发现页/我的页订阅刷新；
 * - 页面一律经 readFlags()/featureEnabled() 取数，不直接读 storage。
 */

export type FeatureKey = 'chat' | 'translate';

/** 本地存储 key：'1' = 开，'0'/不存在 = 关 */
export const FEATURE_STORAGE_KEYS: Record<FeatureKey, string> = {
  chat: 'feature_chat',
  translate: 'feature_translate',
};

/** 暗门解锁标记：'1' = 已解锁（发现页「功能设置」入口卡常驻）；不存在 = 未解锁 */
export const LABS_UNLOCKED_KEY = 'labs_unlocked';

/** 开关变更广播事件名（app.eventBus 承载） */
export const FLAGS_UPDATED_EVENT = 'flags:updated';

/** 页面渲染用汇总状态 */
export interface FlagsState {
  chat: boolean;
  translate: boolean;
  labsUnlocked: boolean;
}

/** 单功能判定：无存储值 / 非法值 / 读异常一律按「关」处理（安全侧） */
export function featureEnabled(f: FeatureKey): boolean {
  try {
    return wx.getStorageSync(FEATURE_STORAGE_KEYS[f]) === '1';
  } catch {
    return false;
  }
}

/** 暗门是否已解锁（入口卡常驻显示的唯一判据） */
export function isLabsUnlocked(): boolean {
  try {
    return wx.getStorageSync(LABS_UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

/** 汇总读取：页面 data.flags 的唯一取数入口 */
export function readFlags(): FlagsState {
  return {
    chat: featureEnabled('chat'),
    translate: featureEnabled('translate'),
    labsUnlocked: isLabsUnlocked(),
  };
}

/** 变更广播：getApp 不可用（极早期时序）时仅写存储、跳过广播，不阻断开关本身 */
function broadcast(): void {
  try {
    const app = getApp<IAppOption>();
    if (app && app.eventBus && typeof app.eventBus.emit === 'function') {
      app.eventBus.emit(FLAGS_UPDATED_EVENT, readFlags());
    }
  } catch {
    /* 广播失败不影响开关落盘 */
  }
}

/** 写开关并广播（设置页开关变更的唯一写入口） */
export function setFeatureEnabled(f: FeatureKey, on: boolean): void {
  try {
    wx.setStorageSync(FEATURE_STORAGE_KEYS[f], on ? '1' : '0');
  } catch {
    return;
  }
  broadcast();
}

/**
 * 暗门解锁（双击发现 tab 触发，custom-tab-bar 调用）。
 * 幂等：已解锁时不重复写存储/广播 —— 已解锁后的再次双击由调用方直接进设置页。
 */
export function unlockLabs(): void {
  if (isLabsUnlocked()) return;
  try {
    wx.setStorageSync(LABS_UNLOCKED_KEY, '1');
  } catch {
    return;
  }
  broadcast();
}
