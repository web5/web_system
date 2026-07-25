import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { UserInfo } from '@web-system/types';

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
      localStorage.setItem('access_token', newToken);
      localStorage.setItem('refresh_token', newRefreshToken);
    }

    function setUserInfo(info: UserInfo) {
      userInfo.value = info;
      localStorage.setItem('user_info', JSON.stringify(info));
    }

    function logout() {
      token.value = '';
      refreshToken.value = '';
      userInfo.value = null;
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user_info');
    }

    function initFromStorage() {
      const storedToken = localStorage.getItem('access_token');
      const storedRefreshToken = localStorage.getItem('refresh_token');
      const storedUserInfo = localStorage.getItem('user_info');
      if (storedToken) {
        token.value = storedToken;
      }
      if (storedRefreshToken) {
        refreshToken.value = storedRefreshToken;
      }
      if (storedUserInfo) {
        try {
          userInfo.value = JSON.parse(storedUserInfo);
        } catch { /* ignore */ }
      }
    }

    /** 已登录但 userInfo 为空时，从服务端获取用户信息 */
    async function fetchUserInfo() {
      if (!token.value || userInfo.value) return;
      try {
        const res = await fetch('/api/auth/verify', {
          headers: { Authorization: `Bearer ${token.value}` },
        });
        const result = await res.json();
        if (result.code === 200) {
          setUserInfo(result.data);
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
      initFromStorage,
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
