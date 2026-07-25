<template>
  <a-config-provider :theme="lightTheme">
    <div class="login-container">
      <router-link to="/" class="back-home">
        <ArrowLeftOutlined />
        <span>返回首页</span>
      </router-link>
      <LoginPanel :qrcode-ticket="qrcodeTicket" @login-success="onLoginSuccess" />
    </div>
  </a-config-provider>
</template>

<script setup lang="ts">
import { ArrowLeftOutlined } from '@ant-design/icons-vue';
import { ConfigProvider as AConfigProvider, theme as antdTheme } from 'ant-design-vue';
import { useRouter, useRoute } from 'vue-router';
import LoginPanel from '@/components/LoginPanel.vue';

const router = useRouter();
const route = useRoute();

// 登录页强制 light theme（覆盖 App.vue 的全局暗色 token）
const lightTheme = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorPrimary: '#FF8C42',
    colorSuccess: '#7ED957',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorText: '#333333',
    colorTextSecondary: '#666666',
    colorTextTertiary: '#999999',
    colorBorder: '#E5E5E5',
    borderRadius: 12,
  },
};

// 检测是否从扫码进入（二维码中携带 qrcode_ticket 参数）
const qrcodeTicket = route.query.qrcode_ticket as string | undefined;

function onLoginSuccess() {
  // 从 URL query 中获取 redirect 参数，没有则返回首页
  const redirect = route.query.redirect as string;
  router.push(redirect || '/');
}
</script>

<style scoped>
.login-container {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh;
  background: linear-gradient(180deg, #FFFBF5 0%, #FFF8F0 100%);
  position: relative; overflow: hidden;
}
.back-home {
  position: absolute; top: 28px; left: 32px;
  color: #999; font-size: 14px;
  text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
  transition: color 0.3s; z-index: 10;
}
.back-home:hover { color: #FF8C42; }
</style>
