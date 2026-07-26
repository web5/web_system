<template>
  <div class="forbidden">
    <div class="forbidden-inner">
      <div class="forbidden-code">403</div>
      <h1 class="forbidden-title">无权限访问</h1>
      <p class="forbidden-desc">你没有访问该页面的权限，请联系管理员</p>
      <div class="forbidden-actions">
        <router-link to="/" class="btn-primary">返回工作台</router-link>
      </div>
    </div>
  </div>
</template>

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
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.2s;
}

.btn-primary:hover { background: #ea580c; }
</style>
