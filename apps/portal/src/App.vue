<template>
  <a-config-provider :theme="theme">
    <div class="app-shell">
      <div class="app-main">
        <router-view />
      </div>
      <app-footer />
    </div>
  </a-config-provider>
</template>

<script setup lang="ts">
import { ConfigProvider as AConfigProvider } from 'ant-design-vue';
import AppFooter from '@/components/AppFooter.vue';

const theme = {
  token: {
    colorPrimary: '#f97316',
    colorLink: '#f97316',
    colorSuccess: '#7ED957',
    borderRadius: 8,
    colorBgContainer: '#0C0C0D',
    colorText: '#F8FAFC',
    colorTextSecondary: '#94A3B8',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif",
  },
};
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
