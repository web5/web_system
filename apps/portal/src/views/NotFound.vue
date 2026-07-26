<template>
  <div class="not-found">
    <div class="not-found-inner">
      <div class="not-found-code">404</div>
      <h1 class="not-found-title">页面走丢啦</h1>
      <p class="not-found-desc">你访问的页面不存在或已被移除</p>
      <div class="not-found-actions">
        <router-link to="/" class="btn-primary">返回首页</router-link>
        <button class="btn-secondary" @click="goBack">返回上一页</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/');
  }
}
</script>

<style scoped>
.not-found {
  min-height: calc(100vh - 64px - 80px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

.not-found-inner {
  text-align: center;
  max-width: 480px;
}

.not-found-code {
  font-size: 120px;
  font-weight: 800;
  color: #FF8C42;
  line-height: 1;
  margin-bottom: 16px;
  letter-spacing: -4px;
}

.not-found-title {
  font-size: 28px;
  font-weight: 700;
  color: #333;
  margin: 0 0 12px;
}

.not-found-desc {
  font-size: 15px;
  color: #888;
  margin: 0 0 32px;
}

.not-found-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn-primary {
  padding: 10px 24px;
  background: #FF8C42;
  color: #FFFFFF;
  border-radius: 16px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.2s;
}

.btn-primary:hover { background: #e67e3a; }

.btn-secondary {
  padding: 10px 24px;
  background: #FFF8F0;
  color: #FF8C42;
  border: 1px solid rgba(255, 140, 66, 0.3);
  border-radius: 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover {
  background: #FFEDD9;
  border-color: #FF8C42;
}
</style>