<template>
  <div class="dashboard">
    <a-card title="欢迎使用管理后台">
      <p>这是一个基于 Vue3 + Ant Design Vue + NestJS 的全栈管理系统。</p>
      <a-row :gutter="16" style="margin-top: 24px">
        <a-col :span="8">
          <a-card size="small" title="用户管理">
            <p>管理系统用户信息</p>
          </a-card>
        </a-col>
        <a-col :span="8">
          <a-card size="small" title="权限管理">
            <p>配置角色和权限</p>
          </a-card>
        </a-col>
        <a-col :span="8">
          <a-card size="small" title="系统设置">
            <p>系统参数配置</p>
          </a-card>
        </a-col>
      </a-row>
    </a-card>
  </div>
</template>

<script setup lang="ts">
// Dashboard 组件
</script>

<style scoped>
.dashboard {
  padding: 24px;
}
</style>
