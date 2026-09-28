<template>
  <div class="error-page">
    <a-result status="404" title="404" sub-title="抱歉，你访问的页面不存在">
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
  /* 扣掉基座备案条高度（:root 变量，见 App.vue） */
  min-height: calc(100vh - var(--site-beian-bar-h, 0px));
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
