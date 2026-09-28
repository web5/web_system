<template>
  <footer class="site-beian-bar">
    <span class="beian-copy">Copyright &copy; 2023 - 2026 kedouai.com</span>
    <span class="beian-sep">|</span>
    <span>
      备案号：<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">粤ICP备2021031984号</a>
    </span>
    <span class="beian-sep">|</span>
    <a
      class="beian-police"
      href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=44030902002737"
      target="_blank"
      rel="noopener noreferrer"
    >
      <svg class="beian-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10 2L3 5.5V10c0 4.42 3.13 8.62 7 9.5 3.87-.88 7-5.08 7-9.5V5.5L10 2z" />
      </svg>
      公安备案号：44030902002737号
    </a>
  </footer>
</template>

<script setup lang="ts">
/**
 * 全站备案条（基座职责）
 *
 * 法定要求备案信息在站点所有页面可及。基座 shell 是唯一的全路由公共层
 * （`/`、`/login`、`/admin/*`、404、Forbidden 都走它），所以备案由基座统一提供，
 * 子模块（portal / admin）不必各自实现 —— 历史上 portal 自己实现过，
 * 在换血升级（d1d27b7）时漏挂，导致备案号整站消失。
 *
 * 为什么是 fixed 而不是内容流：模块布局普遍 `height: 100%` 占满视口，
 * 内容流 footer 会掉到视口之外（要滚动才看得到），等于没有。
 *
 * 样式只用 `--ws-*` token（与 EnvSwitcher 同口径），深浅主题都能落。
 */
</script>

<style scoped>
.site-beian-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  /* 低于环境切换挂件（z-index 1080）：dev 下挂件浮在条之上，互不遮挡 */
  z-index: 900;
  /* 高度取自避让变量（shell App.vue 的 :root），模块按同一变量扣减根容器高度 */
  height: var(--site-beian-bar-h, 30px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  line-height: 1;
  color: var(--ws-text-tertiary, #8c8c8c);
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(6px);
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.site-beian-bar a {
  color: var(--ws-text-tertiary, #8c8c8c);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  transition: color 0.2s;
}

.site-beian-bar a:hover {
  color: var(--ws-brand-500, #fa8c16);
}

.beian-sep {
  color: var(--ws-border-strong, #ddd);
  margin: 0 2px;
}

.beian-icon {
  width: 13px;
  height: 13px;
  vertical-align: -2px;
}

/* 窄屏：只保留两段备案号，版权文字收起，避免换行顶高固定条 */
@media (max-width: 640px) {
  .beian-copy,
  .beian-copy + .beian-sep {
    display: none;
  }
}
</style>
