<template>
  <div class="sub">
    <div class="chead">
      <button type="button" class="btn-back" @click="router.push('/profile')">
        <app-icon name="left" />返回
      </button>
      <h1>用户记忆</h1>
    </div>

    <div class="tip"><app-icon name="spark" />AI 每次对话后，从你们的聊天里提炼关于你的稳定信息，可单条删除</div>

    <div v-if="!loading && empty" class="empty">
      <app-icon name="spark" size="lg" />
      <p>还没有记忆，去对话里多聊聊，AI 会慢慢认识你</p>
    </div>

    <div v-else class="groups">
      <div v-for="g in groups" :key="g.cat" class="group">
        <h3>{{ g.cat }} <em>{{ g.items.length }} 条</em></h3>
        <div v-for="m in g.items" :key="m.id" class="row">
          <span class="txt">{{ m.content }}</span>
          <button type="button" class="rm" title="删除" @click="remove(m.id)">
            <app-icon name="x" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { listMemory, removeMemory, type MemoryItem } from '@/api/user-memory';
import AppIcon from '@/components/AppIcon.vue';

const router = useRouter();
const loading = ref(true);
const empty = ref(false);
const items = ref<MemoryItem[]>([]);

const CATS = ['事实', '偏好', '习惯'];

const groups = ref<Array<{ cat: string; items: MemoryItem[] }>>([]);

async function load() {
  loading.value = true;
  try {
    const { list } = await listMemory(1, 50);
    items.value = list;
    empty.value = list.length === 0;
    groups.value = CATS.map((cat) => ({ cat, items: list.filter((m) => m.category === cat) })).filter(
      (g) => g.items.length > 0,
    );
  } catch {
    empty.value = true;
    items.value = [];
    groups.value = [];
  } finally {
    loading.value = false;
  }
}

async function remove(id: number) {
  const ok = await removeMemory(id);
  message.success(ok ? '已删除该记忆' : '删除失败，请重试');
  if (ok) void load();
}

onMounted(() => void load());
</script>

<style scoped>
.sub {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 32px 24px;
}

.chead {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.chead h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--ws-radius-md);
  font-size: 13px;
  color: var(--ws-text-secondary);
}

.btn-back:hover {
  background: var(--ws-bg-subtle);
}

.tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-bottom: 16px;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--ws-text-tertiary);
  font-size: 13px;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}

.group h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 8px;
}

.group h3 em {
  font-style: normal;
  font-weight: 400;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-left: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  margin-bottom: 8px;
}

.txt {
  flex: 1;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ws-text-primary);
}

.rm {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: var(--r-chip);
  color: var(--ws-text-tertiary);
}

.rm:hover {
  background: var(--ws-bg-subtle);
  color: var(--ws-error-500);
}
</style>
