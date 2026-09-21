/**
 * 登录门（auth gate）
 *
 * 欢迎页是公开页（page-spec §0）：未登录可浏览，互动时弹「登录 / 注册」弹窗，
 * 登录成功后**继续原动作**（如「开始对话」），而不是把用户甩到 /login 整页。
 * 需鉴权的路由仍走路由守卫的 `/login?redirect=` 整页跳转，两套并存。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useUserStore } from './user';

export const useAuthGateStore = defineStore('portal-auth-gate', () => {
  const open = ref(false);
  /** 登录成功后要继续的动作（进入对话 / 新建会话 …） */
  const pendingAction = ref<(() => void) | null>(null);

  /**
   * 鉴权门：已登录立即执行 action 并返回 true；
   * 未登录弹登录/注册弹窗（action 挂起，登录成功后续跑）并返回 false。
   */
  function ensureAuth(action?: () => void): boolean {
    const userStore = useUserStore();
    if (userStore.isLoggedIn) {
      action?.();
      return true;
    }
    pendingAction.value = action ?? null;
    open.value = true;
    return false;
  }

  function openAuth(): void {
    open.value = true;
  }

  function closeAuth(): void {
    open.value = false;
    pendingAction.value = null;
  }

  /** 登录成功回调（LoginPanel 的 login-success）：关弹窗 → 续跑挂起动作 */
  function onLoggedIn(): void {
    open.value = false;
    const action = pendingAction.value;
    pendingAction.value = null;
    action?.();
  }

  return { open, ensureAuth, openAuth, closeAuth, onLoggedIn };
});
