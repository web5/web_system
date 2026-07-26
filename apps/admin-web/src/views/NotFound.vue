<template>
  <div class="not-found">
    <div class="not-found-inner">
      <div class="not-found-code">404</div>
      <h1 class="not-found-title">页面不存在</h1>
      <p class="not-found-desc">你访问的页面不存在或已被移除</p>
      <div class="not-found-actions">
        <router-link to="/" class="btn-primary">返回工作台</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
}

.not-found-inner {
  text-align: center;
  max-width: 480px;
}

.not-found-code {
  font-size: 100px;
  font-weight: 800;
  color: #f97316;
  line-height: 1;
  margin-bottom: 12px;
  letter-spacing: -4px;
}

.not-found-title {
  font-size: 24px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 8px;
}

.not-found-desc {
  font-size: 14px;
  color: #64748b;
  margin: 0 0 28px;
}

.not-found-actions {
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
