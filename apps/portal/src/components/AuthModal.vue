<template>
  <a-modal
    :open="gate.open"
    :footer="null"
    :closable="false"
    :width="480"
    :body-style="{ padding: '0' }"
    :get-container="false"
    @cancel="gate.closeAuth()"
  >
    <!-- 复用登录/注册面板：closable 由面板自带关闭按钮承担 -->
    <LoginPanel closable @close="gate.closeAuth()" @login-success="gate.onLoggedIn()" />
  </a-modal>
</template>

<script setup lang="ts">
import LoginPanel from './LoginPanel.vue';
import { useAuthGateStore } from '@/stores/authGate';

const gate = useAuthGateStore();
</script>
