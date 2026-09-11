<template>
  <div class="forbidden">
    <div class="forbidden-inner">
      <div class="forbidden-code">403</div>
      <h1 class="forbidden-title">无权限访问</h1>
      <p class="forbidden-desc">{{ hint || '你没有访问该页面的权限，请联系管理员' }}</p>
      <div class="forbidden-actions">
        <button type="button" class="btn-primary" @click="go">{{ label }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSafeReturn } from '@/composables/useSafeReturn';

/**
 * 「返回」按钮不能写死跳工作台：当前账号若连工作台都没权限，守卫会把导航再送回
 * /403，用户看到的就是"点了没反应"。改为跳到有权限的第一个页面，都没有则退出登录。
 */
const { label, hint, go } = useSafeReturn();
</script>

<style scoped>
.forbidden {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
}

.forbidden-inner {
  text-align: center;
  max-width: 480px;
}

.forbidden-code {
  font-size: 100px;
  font-weight: 800;
  color: #f59e0b;
  line-height: 1;
  margin-bottom: 12px;
  letter-spacing: -4px;
}

.forbidden-title {
  font-size: 24px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 8px;
}

.forbidden-desc {
  font-size: 14px;
  color: #64748b;
  margin: 0 0 28px;
}

.forbidden-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn-primary {
  padding: 10px 24px;
  background: #f97316;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover { background: #ea580c; }
</style>
