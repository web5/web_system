<template>
  <div class="error-page">
    <a-result status="403" title="403" sub-title="抱歉，你没有权限访问该页面">
      <template #extra>
        <a-button type="primary" @click="goHome">返回首页</a-button>
      </template>
    </a-result>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
const router = useRouter();
function goHome() {
  router.replace('/portal/');
}
</script>

<style>
.error-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
