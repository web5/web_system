# assets/shared-public —— 公共静态资源唯一源

这里存放**所有端**（portal / admin 模块产物）都会用到的静态资源，是唯一真值源。
产出与访问路径：`/static/cdn/pub/**`（常量定义在 `scripts/vite-public-assets.mjs`）。

## 流转链路

```
assets/shared-public/**            （源，入 git）
        │ node scripts/build-public-assets.mjs
        ▼
servers/gateway/public/static/cdn/pub/**   （产物，.gitignore）
        │ scripts/deploy.sh → deploy_cdn() 整包 tar 覆盖远端 cdn/
        ▼
浏览器  GET /static/cdn/pub/logo.svg       （gateway 托管）
```

- 与 `scripts/build-externals.mjs` 产出的 vue/antd UMD 同处 `public/static/cdn/`，
  **复用同一条 `deploy_cdn()` 投递通道**，不需要改流水线。
- 缓存：`servers/gateway/src/static/static.module.ts` 里 `CDN_DIR_RE` 已把 `/static/cdn/`
  判为「路径不变而内容会变」→ `no-cache`，资源改名/更新后能生效。

## 代码里怎么引用

**`<script setup>` 里**（script 层可以直接用全局常量）：

```ts
const logoUrl = `${__PUBLIC_ASSET_BASE__}logo.svg`;
```

**模板里**（⚠️ 有个坑）：`__PUBLIC_ASSET_BASE__` 是**编译期全局常量**，不是组件实例属性，
直接写进模板会被 `vue-tsc` 判为 TS2339（Property '__PUBLIC_ASSET_BASE__' does not exist on type
'CreateComponentPublicInstanceWithMixins<…>'）—— 全局 `declare const` 对模板表达式不生效。
所以必须先在 script 里接一层，模板再用这个变量：

```vue
<script setup lang="ts">
const assetBase = __PUBLIC_ASSET_BASE__;
</script>

<template>
  <img :src="assetBase + 'logo.svg'" />
</template>
```

各 app 的 `src/env.d.ts` 里声明了 `__PUBLIC_ASSET_BASE__`（少了会让 script 层报 TS2580）。

⚠️ **禁止**再写 `/logo.svg`、`${import.meta.env.BASE_URL}logo.svg`：
前者依赖 gateway public 根目录下一份无人维护的拷贝，后者会让每个版本目录重复塞 4~5MB 资源，
且一旦 base 的产品线段与投递目录不一致就静默 404。

## 本地独立开发（standalone）

各 app 的 `vite.config.ts` 已把 `/static` 代理到本机 gateway（6000），
所以 `npm run dev` 前请先把 gateway 跑起来，并执行一次发布：

```bash
node scripts/build-public-assets.mjs
```

## 素材 SVG（materials/svg/）

由 `apps/portal/scripts/generate-materials.mjs` 生成，**不要再手动拷贝**。
生成后请照常执行本目录的发布脚本。
