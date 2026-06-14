<template>
  <footer class="app-footer">
    <div class="footer-inner">
      <p class="footer-copyright">
        Copyright &copy; 2023 - 2026 kedouai.com. All Rights Reserved. 一个橙子 版权所有
      </p>
      <p class="footer-icp">
        备案号：<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">粤ICP备2021031984号</a>
        <span class="footer-sep">|</span>
        <a
          href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=44030902002737"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg class="beian-icon" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2L3 5.5V10c0 4.42 3.13 8.62 7 9.5 3.87-.88 7-5.08 7-9.5V5.5L10 2z"/>
          </svg>
          公安备案号：44030902002737号
        </a>
      </p>
    </div>
  </footer>
</template>

<style scoped>
.app-footer {
  width: 100%;
  background: #FFFBF5;
  border-top: 1px solid rgba(255, 140, 66, 0.08);
  padding: 24px 0;
}

.footer-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  text-align: center;
}

.footer-copyright {
  font-size: 13px;
  color: #999;
  margin: 0 0 8px;
  line-height: 1.6;
}

.footer-icp {
  font-size: 12px;
  color: #aaa;
  margin: 0;
  line-height: 1.6;
}

.footer-icp a {
  color: #aaa;
  text-decoration: none;
  transition: color 0.2s;
}

.footer-icp a:hover {
  color: #FF8C42;
}

.footer-sep {
  margin: 0 10px;
  color: #ddd;
}

.beian-icon {
  width: 14px;
  height: 14px;
  vertical-align: -2px;
  margin-right: 2px;
}
</style>
