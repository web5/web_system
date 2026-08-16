<template>
  <router-view />
</template>

<script setup lang="ts">
// 基座根组件：不做业务布局（布局由各模块自带），只承载 router-view。
// 登录页走 /login；模块挂载走 /:module/*（ModuleContainer 占满页面）。
</script>
