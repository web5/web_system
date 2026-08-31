/**
 * 按钮级权限指令：v-has-perm="'agents:manage'" 或 v-has-perm="['agents:manage','skills:view']"
 * 无权限时移除元素。
 */
import type { Directive } from 'vue';
import { useUserStore } from '@/stores/user';

export const vHasPerm: Directive<HTMLElement, string | string[]> = {
  mounted(el, binding) {
    const required = binding.value;
    if (!required) return;
    const userStore = useUserStore();
    const codes = Array.isArray(required) ? required : [required];
    const ok = codes.some((c) => userStore.hasPermission(c));
    if (!ok) {
      el.parentNode?.removeChild(el);
    }
  },
};
