import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { UserInfo } from '@web-system/types';
import request from '@/api/request';

/**
 * 获取 localStorage 中存储的 token（用于请求拦截器等无法注入 pinia 的场景）
 */
export function getStoredToken(): string | null {
  try {
    const raw = localStorage.getItem('user-store');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.token || null;
  } catch {
    return null;
  }
}

export const useUserStore = defineStore(
  'user',
  () => {
    const token = ref<string>('');
    const refreshToken = ref<string>('');
    const userInfo = ref<UserInfo | null>(null);

    const isLoggedIn = computed(() => !!token.value);

    function setToken(newToken: string, newRefreshToken: string) {
      token.value = newToken;
      refreshToken.value = newRefreshToken;
    }

    function setUserInfo(info: UserInfo) {
      userInfo.value = info;
    }

    function logout() {
      token.value = '';
      refreshToken.value = '';
      userInfo.value = null;
    }

    /**
     * 拉取 / 刷新当前用户信息（已登录就发请求）。
     *
     * 不短路 userInfo 已经存在的情况 —— 跨设备 AC2 需要「服务端为准」的契约：
     * 即便本地 hydrate 出旧 userInfo（如旧版的 username 但新版的 preferences），
     * 也应以最新一次请求覆盖之，并触发下游 watcher 收敛 uiPrefs。
     *
     * 口径：specs/radius-style-dual/page-spec-pref-sync.md §4.1 / AC2
     */
    async function fetchUserInfo() {
      if (!token.value) return;
      try {
        const res: any = await request.get('/auth/verify');
        if (res.code === 200 && res.data) {
          setUserInfo(res.data);
        }
      } catch {
        // 静默处理，刷新页面后重试
      }
    }

    return {
      token,
      refreshToken,
      userInfo,
      isLoggedIn,
      setToken,
      setUserInfo,
      logout,
      fetchUserInfo,
    };
  },
  {
    persist: {
      key: 'user-store',
      storage: localStorage,
    },
  },
);
