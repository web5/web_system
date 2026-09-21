<template>
  <a-config-provider :theme="theme">
    <a-app>
      <!-- 登录页：全屏独立布局，不带工作台外壳 -->
      <router-view v-if="isFullscreen" />

      <!-- 三栏外壳：顶栏（一级导航）+ 左栏（记录列表）+ 中栏（工作区）+ 右栏（上下文） -->
      <div v-else class="app-shell">
        <app-navbar @open-command="commandOpen = true" />
        <div class="app-body">
          <app-side-list v-if="navItem?.sideList" :title="navItem.listTitle" />
          <main class="app-work">
            <router-view />
          </main>
          <app-context-panel v-if="navItem?.context" :title="contextTitle" />
        </div>
      </div>

      <command-palette :open="commandOpen" @close="commandOpen = false" />
    </a-app>
  </a-config-provider>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ConfigProvider as AConfigProvider, App as AApp, message } from 'ant-design-vue';
import AppNavbar from '@/components/AppNavbar.vue';
import AppSideList from '@/components/AppSideList.vue';
import AppContextPanel from '@/components/AppContextPanel.vue';
import CommandPalette from '@/components/CommandPalette.vue';
import { matchNavItem } from '@/config/nav';
import { BRAND } from '@/config/theme';
import { useUserStore } from '@/stores/user';
import { useConversationStore } from '@/stores/conversations';

const theme = {
  token: {
    colorPrimary: BRAND[500],
    colorLink: BRAND[500],
    borderRadius: 8,
    colorBgContainer: '#FFFFFF',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif",
  },
};

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const conversationStore = useConversationStore();

const commandOpen = ref(false);

/** 登录页全屏；其余走三栏外壳 */
const isFullscreen = computed(() => route.path === '/login');
const navItem = computed(() => matchNavItem(route.path));

/** 右栏标题：仅翻译（术语库）与合翻（合同原文）启用，P2/P3 打开 context 后生效 */
const contextTitle = computed(() => (navItem.value?.key === 'translate' ? '术语库' : '合同原文'));

function onKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) {
    if (e.key === 'Escape' && commandOpen.value) commandOpen.value = false;
    return;
  }
  if (e.key.toLowerCase() === 'k') {
    e.preventDefault();
    commandOpen.value = !commandOpen.value;
    return;
  }
  if (e.key.toLowerCase() === 'n') {
    e.preventDefault();
    conversationStore.startNew();
    void router.push('/chat');
    return;
  }
  if (e.key === '/') {
    e.preventDefault();
    message.info('⌘K 命令面板 · ⌘N 新建对话 · ⌘/ 快捷键 · Esc 关闭');
  }
}

onMounted(() => {
  userStore.fetchUserInfo();
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});

// 登录后（含刷新恢复 token）拉取会话列表；未登录时左栏由路由守卫挡在登录页
watch(
  () => userStore.isLoggedIn,
  (ok) => {
    if (ok) void conversationStore.load();
  },
  { immediate: true },
);
</script>

<style scoped>
.app-shell {
  height: 100vh;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--ws-bg-subtle);
}

.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.app-work {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--ws-bg-subtle);
}
</style>
