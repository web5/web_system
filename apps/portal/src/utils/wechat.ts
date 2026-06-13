/**
 * 微信环境检测工具
 *
 * 检测当前浏览器是否为微信内置浏览器，以及是否为移动端。
 * 用于登录页面根据环境自动切换 UI：
 * - 微信内置浏览器 → 一键授权登录
 * - 桌面/普通移动浏览器 → 二维码扫码登录
 */

/** 是否为微信内置浏览器 */
export function isWechatBrowser(): boolean {
  return /MicroMessenger/i.test(navigator.userAgent);
}

/** 是否为移动端设备 */
export function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
}

/** 获取微信 OAuth 授权跳转 URL */
export function getWechatOAuthUrl(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
  const frontendRedirect = window.location.origin + '/login';
  return `${baseUrl}/auth/wechat/authorize?redirect=${encodeURIComponent(frontendRedirect)}`;
}

/**
 * 处理 OAuth 回调返回的 token
 * 在 /login 页面 onMounted 时调用，检查 URL 中的 token 参数
 */
export function handleOAuthCallback(): { accessToken: string; refreshToken: string } | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const refreshToken = params.get('refreshToken');

  if (token && refreshToken) {
    // 清除 URL 参数（不刷新页面）
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    url.searchParams.delete('refreshToken');
    window.history.replaceState({}, '', url.toString());

    return { accessToken: token, refreshToken };
  }
  return null;
}
