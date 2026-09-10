// utils/device.ts
// 从 draw.ts 的 detectDevice() 提取出来的纯函数
// TDD：先写测试（失败），再实现此文件（通过）

export interface DeviceInfo {
  isIPad: boolean;
  isLandscape: boolean;
}

/**
 * 检测当前设备类型和屏幕方向
 * 纯函数，易于单元测试
 */
export function detectDevice(): DeviceInfo {
  try {
    const info = wx.getSystemInfoSync();
    const isIPad = info.model?.indexOf('iPad') >= 0;
    const isLandscape = info.windowWidth > info.windowHeight;
    return { isIPad, isLandscape };
  } catch (_) {
    // wx API 失败时返回安全默认值
    return { isIPad: false, isLandscape: false };
  }
}
