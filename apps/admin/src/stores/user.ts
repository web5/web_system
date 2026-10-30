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
      // 必须是真数组：历史上 roles 若是字符串 / undefined，`flatMap` 会抛
      // TypeError，而它又在 fetchPermissions 的 catch 分支里被调用 ——
      // 二次抛出会让权限停留在初始空数组，表现为整站 403。
      const raw = userInfo.value?.roles as unknown;
      return Array.isArray(raw) && raw.length ? (raw as Role[]) : ['viewer'];
    });

    /**
     * 本地 fallback：按角色展开 ROLE_PERMISSIONS。
     *
     * 🔴 未知角色（不在四个内置角色内，典型是 auth-service 的兜底值 `'user'`）
     * **必须退回 viewer 档，不能返回空数组** —— 空数组会让每个页面都 403，
     * 且 /403 页据此显示「当前账号没有后台访问权限」，把「后端没拿到权限」
     * 说成「账号没权限」（issue #478）。看得见工作台、点得动的地方不多，
     * 也比整站不可用 + 误导性文案要好。
     */
    const fallbackPermissions = (): string[] => {
      const known = roles.value.filter((r) => r in ROLE_PERMISSIONS);
      if (known.length) {
        return [...new Set(known.flatMap((r) => ROLE_PERMISSIONS[r] || []))];
      }
      return ROLE_PERMISSIONS.viewer;
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
        const list = Array.isArray(res) ? res : (res?.permissions || res?.data || []);
        if (list.length) {
          permissions.value = list;
          return;
        }
        // 🔴 空响应 ≠ 没有权限。最常见的是 304（Not Modified）：响应体为空，
        // 语义是「权限没变」，不是「权限为空」。早期版本在这里直接覆盖成 fallback，
        // 304 场景下会把一份正常权限清成空 → 整站 403（issue #478）。
        // 已有权限就原样保留；只有确实一份都没有时才用 fallback。
        if (!permissions.value.length) {
          permissions.value = fallbackPermissions();
        }
      } catch {
        if (!permissions.value.length) {
          permissions.value = fallbackPermissions();
        }
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
    /**
     * 只持久化登录凭据与用户信息，**权限码不落盘**：
     * permissions / permissionsReady 是短时缓存，落盘后一旦被写脏（空数组 + ready=true），
     * 后续会话会一直沿用，表现为菜单塌陷成只剩「工作台」。
     * 每次页面加载由路由守卫重新拉取（见 router/index.ts）。
     */
    persist: {
      key: 'user-store',
      storage: localStorage,
      /**
       * 只持久化身份态，**权限码每次会话重新拉取**。
       *
       * 历史问题：permissions / permissionsReady 一起被持久化后，刷新页面时
       * 路由守卫的 `if (!permissionsReady)` 直接短路 → 永不再拉取 →
       * 服务端权限已同步、前端菜单却一直用旧集合（"新权限码加了但菜单不出现"
       * 的第二个根因；第一个是 DB 没 seed）。
       *
       * ⚠️ 选项名必须是 `paths`：本项目 pinia-plugin-persistedstate 为 v3（lockfile 3.2.1），
       * 改名成 `pick` 是 v4 的事 —— 在 v3 下写 `pick` 会被**静默忽略**，等于全量落盘，菜单塌陷复现。
       */
      paths: ['token', 'refreshToken', 'userInfo'],
    },
  },
);
