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
    /**
     * 当前用户权限码（后端 /permissions/my 拉取，admin 特判全量）。
     * 后端不可用时 fallback 到本地 ROLE_PERMISSIONS 常量。
     */
    const permissions = ref<string[]>([]);
    /** 是否已从后端拉取过权限（避免每次路由切换重复请求） */
    const permissionsReady = ref(false);

    const roles = computed<Role[]>(() => {
      return (userInfo.value?.roles as Role[]) || ['viewer'];
    });

    /** 本地 fallback：按角色展开 ROLE_PERMISSIONS */
    const fallbackPermissions = (): string[] => {
      return roles.value.flatMap((r) => ROLE_PERMISSIONS[r] || []);
    };

    function hasPermission(code: string): boolean {
      return permissions.value.includes(code);
    }

    function hasAnyPermission(codes: string[]): boolean {
      return codes.some((c) => permissions.value.includes(c));
    }

    /**
     * 拉取当前用户权限（登录后 / 刷新时调用）。
     * 后端失败或返回空 → fallback 本地常量，保证前端仍可用。
     */
    async function fetchPermissions(): Promise<void> {
      try {
        const { getMyPermissions } = await import('@/api/permissions');
        const res: any = await getMyPermissions();
        const list = Array.isArray(res) ? res : (res?.permissions || []);
        permissions.value = list.length ? list : fallbackPermissions();
      } catch {
        permissions.value = fallbackPermissions();
      } finally {
        permissionsReady.value = true;
      }
    }

    /** 显式写入权限码（登录流程可手动调用） */
    function setPermissions(list: string[]): void {
      permissions.value = list.length ? list : fallbackPermissions();
      permissionsReady.value = true;
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
      permissions.value = [];
      permissionsReady.value = false;
      // pinia persist 插件自动同步 localStorage
    }

    return {
      token, refreshToken, userInfo, roles, permissions, permissionsReady,
      hasPermission, hasAnyPermission,
      fetchPermissions, setPermissions,
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
