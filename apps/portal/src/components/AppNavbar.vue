<template>
  <header class="topbar">
    <router-link to="/" class="brand" title="回到开始页">
      <span class="brand-mark">
        <img :src="logoUrl" alt="科豆 AI" width="32" height="17" />
      </span>
      <span class="brand-name">科豆 AI</span>
    </router-link>

    <!-- 一级导航：配置化（src/config/nav.ts），「我的」不在此处；
         翻译 / 合翻不在顶栏（收进发现），其页面高亮落回「发现」 -->
    <nav class="topnav">
      <router-link
        v-for="item in TOP_NAV_ITEMS"
        :key="item.key"
        :to="item.to"
        class="topnav-item"
        :class="{ 'is-active': activeKey === item.key }"
      >
        <app-icon :name="item.icon" />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <div class="topbar-right">
      <button type="button" class="cmd-entry" @click="emit('open-command')">
        <app-icon name="search" />
        <span class="cmd-entry-text">搜索或执行命令</span>
        <kbd>{{ cmdHint }}</kbd>
      </button>

      <a-dropdown v-if="userStore.isLoggedIn" :trigger="['click']" placement="bottomRight">
        <button type="button" class="avatar" :title="userName">
          {{ avatarText }}
        </button>
        <template #overlay>
          <a-menu>
            <a-menu-item key="profile" @click="go('/profile')">
              <span class="menu-row"><app-icon name="user" />我的</span>
            </a-menu-item>
            <a-menu-divider />
            <a-menu-item key="logout" @click="handleLogout">
              <span class="menu-row"><app-icon name="logout" />退出登录</span>
            </a-menu-item>
          </a-menu>
        </template>
      </a-dropdown>
      <button v-else type="button" class="login-btn" @click="authGate.openAuth()">登录</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Modal } from 'ant-design-vue';
import { TOP_NAV_ITEMS, matchTopNavKey } from '@/config/nav';
import { useUserStore } from '@/stores/user';
import { useAuthGateStore } from '@/stores/authGate';
import AppIcon from './AppIcon.vue';

const emit = defineEmits<{ (e: 'open-command'): void }>();

/**
 * logo 路径跟随构建 base：standalone 模式 base=/portal/，微前端模式
 * base=/static/modules/portal/<env>/<版本>/ —— 写死 /portal/ 会让 MF 构建直接失败
 * （rollup 无法解析绝对路径），且部署后 logo 404。
 */
const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const authGate = useAuthGateStore();

/** ⌘ 在 Mac、Ctrl 在其它平台：只影响提示文案，键位两个都监听 */
const cmdHint = computed(() =>
  /Mac|iPhone|iPad/i.test(navigator.userAgent || '') ? '⌘K' : 'Ctrl K',
);

/** 顶栏高亮：能力页（翻译 / 合翻）不在顶栏，高亮归「发现」 */
const activeKey = computed(() => matchTopNavKey(route.path));

const userName = computed(() => userStore.userInfo?.username || '未登录');

const avatarText = computed(() => {
  const name = userStore.userInfo?.username || '';
  return (name || 'U').slice(0, 1).toUpperCase();
});

function go(path: string) {
  router.push(path);
}

function handleLogout() {
  Modal.confirm({
    title: '退出登录',
    content: '退出后需要重新登录，确定退出吗？',
    okText: '退出登录',
    cancelText: '取消',
    onOk() {
      userStore.logout();
      router.push('/login');
    },
  });
}
</script>

<style scoped>
.topbar {
  flex: 0 0 var(--topbar-h);
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--ws-bg-surface);
  border-bottom: 1px solid var(--ws-border);
  z-index: 20;
}

/* ===== 品牌（点击回开始页） ===== */
.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: var(--ws-text-primary);
  font-size: 16px;
  font-weight: 600;
  flex: 0 0 auto;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
}

.brand-mark img {
  display: block;
}

.brand-name {
  letter-spacing: 0.02em;
}

/* ===== 一级导航 ===== */
.topnav {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
}

.topnav-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border-radius: var(--ws-radius-md);
  color: var(--ws-text-secondary);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease;
}

.topnav-item:hover {
  background: var(--ws-bg-hover);
  color: var(--ws-text-primary);
}

.topnav-item.is-active {
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
  font-weight: 600;
}

/* ===== 右侧 ===== */
.topbar-right {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cmd-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-subtle);
  color: var(--ws-text-secondary);
  font-size: 13px;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.cmd-entry:hover {
  border-color: var(--ws-brand-500);
  color: var(--ws-brand-700);
}

.cmd-entry-text {
  white-space: nowrap;
}

.cmd-entry kbd {
  font: inherit;
  color: var(--ws-text-tertiary);
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid var(--ws-brand-200);
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* 未登录：顶栏给登录入口（弹窗，不跳整页） */
.login-btn {
  height: 32px;
  padding: 0 16px;
  border-radius: var(--ws-radius-md);
  background: var(--ws-brand-500);
  color: var(--ws-brand-50);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s ease;
}

.login-btn:hover {
  background: var(--ws-brand-600);
}

.menu-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 1024px) {
  .cmd-entry-text {
    display: none;
  }
}
</style>
