<template>
  <a-config-provider :theme="theme">
    <a-app>
      <div class="app-shell">
        <!-- 全局顶部导航（登录页 / 全屏页面除外） -->
        <app-navbar v-if="showNavbar" />
        <div class="app-main">
          <router-view />
        </div>
        <app-footer v-if="showFooter" />
      </div>
    </a-app>
  </a-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ConfigProvider as AConfigProvider } from 'ant-design-vue';
import AppNavbar from '@/components/AppNavbar.vue';
import AppFooter from '@/components/AppFooter.vue';
import { useUserStore } from '@/stores/user';

const theme = {
  token: {
    colorPrimary: '#FF8C42',
    colorLink: '#FF8C42',
    colorSuccess: '#7ED957',
    borderRadius: 16,
    colorBgContainer: '#FFFFFF',
    colorText: '#333333',
    colorTextSecondary: '#888888',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif",
  },
};

const route = useRoute();
const userStore = useUserStore();

// 登录页：全屏独立布局，不显示全局 navbar / footer
const showNavbar = computed(() => route.path !== '/login');
const showFooter = computed(() => route.path !== '/login');

onMounted(() => {
  userStore.fetchUserInfo();
});
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>
