/**
 * 右栏（上下文面板）内容 store
 *
 * 外壳 `App.vue` 只负责"在哪些视图渲染右栏"（由 `config/nav.ts` 的 `context` 开关决定），
 * **内容由页面注入**：页面在需要时 `set()`，离开时 `clear()`。
 * 这样右栏不再是空壳 slot，也不会在非目标视图占位（page-spec §1「未启用时整体不占位」）。
 */
import { ref } from 'vue';
import type { Component } from 'vue';

export interface ContextPanelContent {
  /** 右栏标题（如「合同原文」） */
  title: string;
  /** 面板内容组件 */
  component: Component;
  /** 传给组件的 props（变更时整体重新 set，组件 props 随之更新） */
  props?: Record<string, unknown>;
}

const content = ref<ContextPanelContent | null>(null);

export function useContextPanel() {
  return {
    content,
    set(next: ContextPanelContent): void {
      content.value = next;
    },
    clear(): void {
      content.value = null;
    },
  };
}
