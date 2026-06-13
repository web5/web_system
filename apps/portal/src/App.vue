<template>
  <a-config-provider :theme="theme">
    <router-view />
  </a-config-provider>
</template>

<script setup lang="ts">
import { ConfigProvider as AConfigProvider } from 'ant-design-vue';

const theme = {
  token: {
    colorPrimary: '#f97316',
    colorLink: '#f97316',
    borderRadius: 8,
  },
};
</script>
