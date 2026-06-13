import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { UserInfo, Role } from '@web-system/types';
import { ROLE_PERMISSIONS } from '@web-system/types';

export const useUserStore = defineStore(
  'user',
  () => {
    const token = ref<string>('');
    const refreshToken = ref<string>('');
    const userInfo = ref<UserInfo | null>(null);

    const roles = computed<Role[]>(() => {
      return (userInfo.value?.roles as Role[]) || ['viewer'];
    });

    const permissions = computed<string[]>(() => {
      return roles.value.flatMap((r) => ROLE_PERMISSIONS[r] || []);
    });

    function hasPermission(code: string): boolean {
      return permissions.value.includes(code);
    }

    function hasAnyPermission(codes: string[]): boolean {
      return codes.some((c) => permissions.value.includes(c));
    }

    function setToken(newToken: string, newRefreshToken: string) {
      token.value = newToken;
      refreshToken.value = newRefreshToken;
      localStorage.setItem('access_token', newToken);
      localStorage.setItem('refresh_token', newRefreshToken);
    }

    function setUserInfo(info: UserInfo) {
      userInfo.value = info;
    }

    function logout() {
      token.value = '';
      refreshToken.value = '';
      userInfo.value = null;
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }

    function initFromStorage() {
      const storedToken = localStorage.getItem('access_token');
      const storedRefreshToken = localStorage.getItem('refresh_token');
      if (storedToken) {
        token.value = storedToken;
      }
      if (storedRefreshToken) {
        refreshToken.value = storedRefreshToken;
      }
    }

    return {
      token, refreshToken, userInfo, roles, permissions,
      hasPermission, hasAnyPermission,
      setToken, setUserInfo, logout, initFromStorage,
    };
  },
  {
    persist: {
      key: 'user-store',
      storage: localStorage,
    },
  }
);
