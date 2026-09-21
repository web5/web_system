/**
 * 统一会话流（P1）
 *
 * 会话**不按类型隔离**（page-spec §2 风险项）：对话 / 翻译 / 合翻共用一个列表，
 * 数据来自 `GET /api/ai-agent/agent/conversations`（后端只返回 source=chat 的主对话）。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { listConversations, type ConversationSummary } from '@/api/agent';

export const useConversationStore = defineStore('portal-conversations', () => {
  const items = ref<ConversationSummary[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** 当前会话 id；null = 新会话（左栏无选中、中栏空态） */
  const currentId = ref<string | null>(null);

  const isEmpty = computed(() => !loading.value && items.value.length === 0);

  /** 拉取会话列表。并发调用由 loading 闸门拦掉（左栏与页面同时初始化时只发一次） */
  async function load(): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    error.value = null;
    try {
      const res = await listConversations();
      items.value = res.list;
    } catch (err) {
      error.value = (err as Error)?.message || '会话列表加载失败';
    } finally {
      loading.value = false;
    }
  }

  function select(id: string): void {
    currentId.value = id;
  }

  /** 新会话：清空选中态，中栏回到空态 */
  function startNew(): void {
    currentId.value = null;
  }

  /** 本地把会话顶到列表最前（首轮完成后调用，省一次整表重拉） */
  function touch(id: string, title?: string | null): void {
    const idx = items.value.findIndex((i) => i.id === id);
    if (idx > 0) {
      const [hit] = items.value.splice(idx, 1);
      items.value.unshift(hit);
    }
    if (idx === 0 && title) {
      items.value[0] = { ...items.value[0], title };
    }
  }

  function titleOf(id: string | null): string | null {
    if (!id) return null;
    return items.value.find((i) => i.id === id)?.title ?? null;
  }

  return { items, loading, error, currentId, isEmpty, load, select, startNew, touch, titleOf };
});
