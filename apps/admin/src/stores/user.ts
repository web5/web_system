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
      // pinia persist 插件自动序列化到 localStorage，无需手动操作
    }

    function setUserInfo(info: UserInfo) {
      userInfo.value = info;
    }

    function logout() {
      token.value = '';
      refreshToken.value = '';
      userInfo.value = null;
      // pinia persist 插件自动同步 localStorage
    }

    return {
      token, refreshToken, userInfo, roles, permissions,
      hasPermission, hasAnyPermission,
      setToken, setUserInfo, logout,
    };
  },
  {
    persist: {
      key: 'user-store',
      storage: localStorage,
    },
  },
);
