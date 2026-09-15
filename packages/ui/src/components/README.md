# @web-system/ui · 公共组件

## 这里放什么

跨端（admin / deploy-console 等）都会用到、且**展示口径必须一致**的组件。
判断标准（满足其一才放进来）：

- 两处以上会用到，各自实现就会出现展示/文案/校验口径漂移；
- 有「容易做错但后果明显」的细节（如"没拿到权威名单时要显式提示"），值得收口一次。

只在一端用到的组件仍放在各自 `apps/<app>/src/components/`。

## 为什么以**源码**方式被消费

`@web-system/ui` 目前是纯 TS 包：`build` 是 `tsc`，编译不了 `.vue`；
各端消费的是它的 **dist**，而**发布流水线并不构建这个包**
（同类约束见 `apps/admin/src/utils/module-load-error.ts` 的注释）。
若让组件走 dist，就必须给流水线新增构建步骤 —— 这恰恰会制造新的「改了不生效」。

因此组件目录通过**源码直引**消费：由各应用自己的 vite 编译，零额外构建环节。

## 消费方式

1. 应用 `vite.config.ts` 加别名（admin / deploy-console 已配）：

   ```ts
   alias: {
     '@web-system/ui/components': resolve(__dirname, '../../packages/ui/src/components'),
   }
   ```

2. 应用 `tsconfig.json` 加 paths（让 `vue-tsc` 能解析）：

   ```json
   "paths": { "@web-system/ui/components/*": ["../../packages/ui/src/components/*"] }
   ```

3. 使用：

   ```vue
   <script setup lang="ts">
   import UserSelect from '@web-system/ui/components/UserSelect.vue'
   import type { UserSelectLoadResult } from '@web-system/ui/components/UserSelect.types'

   // 数据源由调用方注入：包内不依赖任何一端的 API
   const load = async (): Promise<UserSelectLoadResult> => {
     const r = await myApi.users()
     return { users: r.users, degraded: false }
   }
   </script>

   <template>
     <UserSelect v-model="picked" :load="load" />
   </template>
   ```

## 组件清单

| 组件 | 用途 | 备注 |
|---|---|---|
| `UserSelect.vue` | 人员选择器（单选/多选、搜索、角色标签、degraded 提示） | 数据源由 `load` 注入；`users` 可受控直传 |
