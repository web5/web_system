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
          <!-- 右栏内容由页面注入（stores/context）：nav 只决定"这个视图要不要右栏" -->
          <app-context-panel v-if="navItem?.context && ctxContent" :title="ctxContent.title">
            <component :is="ctxContent.component" v-bind="ctxContent.props" />
          </app-context-panel>
        </div>
      </div>

      <command-palette :open="commandOpen" @close="commandOpen = false" />
      <!-- 公开欢迎页的互动触发的登录/注册弹窗（登录成功后续跑挂起动作） -->
      <auth-modal />
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
import AuthModal from '@/components/AuthModal.vue';
import { matchNavItem } from '@/config/nav';
import { BRAND } from '@/config/theme';
import { useUserStore } from '@/stores/user';
import { useAuthGateStore } from '@/stores/authGate';
import { useConversationStore } from '@/stores/conversations';
import { useContextPanel } from '@/stores/context';

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
const authGate = useAuthGateStore();
const conversationStore = useConversationStore();

const commandOpen = ref(false);

/** 登录页全屏；其余走三栏外壳 */
const isFullscreen = computed(() => route.path === '/login');
const navItem = computed(() => matchNavItem(route.path));

/**
 * 右栏：页面经 store 注入标题与内容（合翻报告 = 合同原文；未注入时不占位）。
 * 这里取 ref 本体绑定（`ctxContent`），模板才能自动解包 —— 嵌套在对象里的 ref 不会解包。
 */
const { content: ctxContent } = useContextPanel();

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
    authGate.ensureAuth(() => {
      conversationStore.startNew();
      void router.push('/chat');
    });
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

// 登录后（含弹窗登录、刷新恢复 token）拉取会话列表；退出登录清空本地会话态
watch(
  () => userStore.isLoggedIn,
  (ok) => {
    if (ok) void conversationStore.load();
    else conversationStore.clear();
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
