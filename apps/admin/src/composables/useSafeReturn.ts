import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useRouter } from 'vue-router';
import type { RouteRecordNormalized } from 'vue-router';
import { useUserStore } from '@/stores/user';

/**
 * 403 / 404 页的「安全返回」逻辑。
 *
 * 背景：这两个页面原先都是写死的 `<router-link to="/">`，指向工作台。
 * 若当前账号连工作台都没有权限（或压根没有后台权限），守卫会把导航再次送回
 * /403，页面看起来"点了没反应"。这里改为：
 *   1. 有权限 → 跳到**有权限的第一个页面**（按侧边栏菜单顺序，工作台优先）；
 *   2. 无任何后台权限 → 退出登录回到登录页（未登录则直接去登录页）。
 *
 * 注意：判定必须与路由守卫同源（都用 userStore.permissions），否则可能跳到
 * 守卫仍然拒绝的页面，形成新的死循环。
 */

/** 与 BasicLayout 侧边栏菜单顺序保持一致，用于挑选"第一个可去的地方" */
const MENU_ORDER = [
  '/dashboard',
  '/bianbian',
  '/users',
  '/settings',
  '/settings/roles',
  '/settings/dicts',
  '/mcp',
  '/database',
  '/agents',
] as const;

function permissionOf(record: RouteRecordNormalized): string | undefined {
  const perm = record.meta?.permission;
  return typeof perm === 'string' ? perm : undefined;
}

function titleOf(record: RouteRecordNormalized): string {
  const title = record.meta?.title;
  return typeof title === 'string' ? title : '可用页面';
}

export interface SafeReturn {
  /** 目标路径；无任何后台权限时为 null */
  target: ComputedRef<string | null>;
  /** 按钮文案 */
  label: ComputedRef<string>;
  /** 无权限时的提示文案（有权限时为空串，页面沿用自身默认描述） */
  hint: ComputedRef<string>;
  /** 绑定到按钮点击 */
  go: () => void;
}

export function useSafeReturn(): SafeReturn {
  const router = useRouter();
  const userStore = useUserStore();

  /** 找第一个"当前账号有权限、能直接落点"的静态路由 */
  const targetRecord = computed<RouteRecordNormalized | null>(() => {
    const allowed = router.getRoutes().filter((record) => {
      const perm = permissionOf(record);
      if (!perm) return false;
      // 带参数的路由（/users/:id、/agents/runs/:agentId…）不能直接作为落点
      if (record.path.includes(':')) return false;
      return userStore.hasPermission(perm);
    });
    if (!allowed.length) return null;
    for (const path of MENU_ORDER) {
      const hit = allowed.find((record) => record.path === path);
      if (hit) return hit;
    }
    return allowed[0];
  });

  const target = computed(() => targetRecord.value?.path ?? null);

  const label = computed(() => {
    if (!targetRecord.value) return userStore.token ? '退出登录' : '去登录';
    if (targetRecord.value.path === '/dashboard') return '返回工作台';
    return `前往「${titleOf(targetRecord.value)}」`;
  });

  const hint = computed(() =>
    targetRecord.value ? '' : '当前账号没有后台访问权限，请改用管理员账号登录',
  );

  const go = (): void => {
    if (targetRecord.value) {
      void router.replace(targetRecord.value.path);
      return;
    }
    if (userStore.token) userStore.logout();
    void router.replace('/login');
  };

  return { target, label, hint, go };
}
