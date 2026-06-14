<template>
  <div class="kedo-portal">
    <!-- 顶部导航 -->
    <nav class="portal-nav">
      <div class="nav-inner">
        <!-- Logo -->
        <div class="nav-brand">
          <div class="brand-logo">
            <svg viewBox="0 0 210 110" xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="0" width="210" height="110" rx="55" fill="#f97316"/>
              <path d="M 105 18 C 127 18, 139 34, 139 60 C 139 90, 121 102, 105 102 C 87 102, 71 88, 71 60 C 71 32, 87 18, 105 18 Z" fill="white"/>
              <circle cx="105" cy="60" r="9" fill="#f97316"/>
              <circle cx="105" cy="58" r="3.5" fill="#FDE68A"/>
              <path d="M 105 18 Q 105 10, 105 7" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
              <circle cx="105" cy="6" r="3.5" fill="white"/>
            </svg>
          </div>
          <span class="brand-name">科豆 AI</span>
        </div>

        <!-- 导航链接 -->
        <div class="nav-links">
          <a href="#" class="nav-link active">首页</a>
          <a href="#howto" class="nav-link">变变</a>
          <a href="#draw" class="nav-link">画板</a>
          <a href="#" class="nav-link">关于我们</a>
        </div>

        <!-- 登录按钮 -->
        <button class="nav-login" @click="router.push('/login')">登录</button>
      </div>
    </nav>

    <!-- Hero 区域 -->
    <section class="hero-section">
      <div class="hero-inner">
        <!-- 左侧内容 -->
        <div class="hero-content">
          <div class="hero-badge">
            <span class="badge-dot"></span>
            新品上线 · 免费体验中
          </div>
          <h1 class="hero-title">
            把孩子的想象力<br/>
            变成看得见的角色
          </h1>
          <p class="hero-subtitle">
            基于孩子的涂鸦，AI 魔法把它变成可爱的3D角色。<br/>
            每个孩子，都是造物主力。
          </p>
          <div class="hero-actions">
            <router-link to="/bianbian" class="hero-btn btn-primary">体验变变</router-link>
            <router-link to="/draw" class="hero-btn btn-secondary">创意画板</router-link>
          </div>
          <p class="hero-hint">PC端体验更好哦，扫码在手机上使用 ↗</p>
        </div>

        <!-- 右侧扫码卡片 -->
        <div class="hero-card">
          <div class="scan-card">
            <div class="scan-header">微信扫码体验</div>
            <div class="scan-qr">
              <div class="qr-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                </svg>
              </div>
            </div>
            <div class="scan-info">
              <p class="scan-app">微信小程序「科豆 AI」</p>
              <p class="scan-slogan">把孩子的涂鸦变成可爱3D角色</p>
            </div>
            <div class="scan-features">
              <span class="feature-tag">实时变身</span>
              <span class="feature-tag">免费体验</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 三步流程 -->
    <section id="howto" class="howto-section">
      <div class="section-inner">
        <h2 class="section-title">变变，怎么玩？</h2>
        <p class="section-subtitle">三步，让孩子的涂鸦变成专属3D角色</p>

        <div class="steps-grid">
          <div class="step-card">
            <div class="step-num">1</div>
            <h3 class="step-title">画一画 / 拼一拼</h3>
            <p class="step-desc">打开画板，拖拽素材拼贴，也可以随手涂鸦</p>
          </div>
          <div class="step-card">
            <div class="step-num">2</div>
            <h3 class="step-title">点「变变」</h3>
            <p class="step-desc">AI 魔法启动，几秒钟变成3D角色</p>
          </div>
          <div class="step-card">
            <div class="step-num">3</div>
            <h3 class="step-title">保存 & 分享</h3>
            <p class="step-desc">原画 vs 角色对比展示，一键保存到相册</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 创意画板 -->
    <section id="draw" class="draw-section">
      <div class="section-inner">
        <div class="draw-content">
          <h2 class="draw-title">创意画板</h2>
          <p class="draw-desc">
            不只是变变——你也可以用画板自由创作。<br/>
            丰富的素材库，简单的涂鸦工具，让孩子随时随地释放创造力。
          </p>
          <router-link to="/draw" class="draw-btn">打开画板</router-link>
        </div>
        <div class="draw-preview">
          <div class="preview-card">
            <span class="preview-label">画板预览</span>
          </div>
        </div>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<style scoped>
.kedo-portal {
  background: linear-gradient(180deg, #FFFBF5 0%, #FFF8F0 100%);
  color: #333;
}

/* ===== 导航栏 ===== */
.portal-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: rgba(255, 251, 245, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 140, 66, 0.08);
}

.nav-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-logo {
  width: 32px;
  height: 32px;
}

.brand-logo svg {
  width: 100%;
  height: 100%;
}

.brand-name {
  font-size: 18px;
  font-weight: 700;
  color: #333;
}

.nav-links {
  display: flex;
  align-items: center;
  gap: 32px;
}

.nav-link {
  font-size: 15px;
  color: #666;
  text-decoration: none;
  transition: color 0.2s;
}

.nav-link:hover,
.nav-link.active {
  color: #FF8C42;
}

.nav-login {
  padding: 8px 20px;
  background: #FF8C42;
  color: #fff;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-login:hover {
  background: #e67e2a;
  transform: translateY(-1px);
}

/* ===== Hero 区域 ===== */
.hero-section {
  padding: 120px 24px 80px;
}

.hero-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 60px;
}

.hero-content {
  flex: 1;
  max-width: 520px;
}

.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(255, 140, 66, 0.1);
  border: 1px solid rgba(255, 140, 66, 0.15);
  border-radius: 20px;
  font-size: 13px;
  color: #FF8C42;
  font-weight: 500;
  margin-bottom: 20px;
}

.badge-dot {
  width: 6px;
  height: 6px;
  background: #FF8C42;
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.hero-title {
  font-size: 42px;
  font-weight: 800;
  color: #333;
  line-height: 1.2;
  margin: 0 0 16px;
  letter-spacing: -0.5px;
}

.hero-subtitle {
  font-size: 16px;
  color: #666;
  line-height: 1.7;
  margin: 0 0 28px;
}

.hero-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.hero-btn {
  padding: 14px 28px;
  border-radius: 24px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.btn-primary {
  background: #FF8C42;
  color: #fff;
  box-shadow: 0 4px 16px rgba(255, 140, 66, 0.3);
}

.btn-primary:hover {
  background: #e67e2a;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(255, 140, 66, 0.4);
}

.btn-secondary {
  background: #fff;
  color: #666;
  border: 1px solid #e0e0e0;
}

.btn-secondary:hover {
  border-color: #FF8C42;
  color: #FF8C42;
}

.hero-hint {
  font-size: 13px;
  color: #999;
  margin: 0;
}

/* 扫码卡片 */
.hero-card {
  flex-shrink: 0;
}

.scan-card {
  width: 280px;
  background: #fff;
  border-radius: 20px;
  padding: 24px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.06);
  border: 1px solid rgba(255, 140, 66, 0.08);
}

.scan-header {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin-bottom: 16px;
  text-align: center;
}

.scan-qr {
  width: 160px;
  height: 160px;
  margin: 0 auto 16px;
  background: #f5f5f5;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-placeholder {
  width: 80px;
  height: 80px;
  color: #ccc;
}

.qr-placeholder svg {
  width: 100%;
  height: 100%;
}

.scan-info {
  text-align: center;
  margin-bottom: 12px;
}

.scan-app {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  margin: 0 0 4px;
}

.scan-slogan {
  font-size: 12px;
  color: #999;
  margin: 0;
}

.scan-features {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.feature-tag {
  padding: 4px 10px;
  background: rgba(255, 140, 66, 0.08);
  border-radius: 12px;
  font-size: 11px;
  color: #FF8C42;
}

/* ===== 三步流程 ===== */
.howto-section {
  padding: 80px 24px;
  background: #fff;
}

.section-inner {
  max-width: 1200px;
  margin: 0 auto;
}

.section-title {
  font-size: 32px;
  font-weight: 700;
  color: #333;
  text-align: center;
  margin: 0 0 8px;
}

.section-subtitle {
  font-size: 15px;
  color: #888;
  text-align: center;
  margin: 0 0 48px;
}

.steps-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.step-card {
  background: #FFFBF5;
  border: 1px solid rgba(255, 140, 66, 0.1);
  border-radius: 20px;
  padding: 32px 24px;
  text-align: center;
  transition: all 0.2s;
}

.step-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 32px rgba(255, 140, 66, 0.1);
  border-color: rgba(255, 140, 66, 0.2);
}

.step-num {
  width: 36px;
  height: 36px;
  background: #FF8C42;
  color: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  margin: 0 auto 16px;
}

.step-title {
  font-size: 18px;
  font-weight: 700;
  color: #333;
  margin: 0 0 8px;
}

.step-desc {
  font-size: 14px;
  color: #888;
  margin: 0;
  line-height: 1.6;
}

/* ===== 创意画板 ===== */
.draw-section {
  padding: 80px 24px;
  background: linear-gradient(180deg, #FFF8F0 0%, #FFFBF5 100%);
}

.draw-section .section-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 60px;
}

.draw-content {
  flex: 1;
}

.draw-title {
  font-size: 32px;
  font-weight: 700;
  color: #333;
  margin: 0 0 12px;
}

.draw-desc {
  font-size: 15px;
  color: #666;
  line-height: 1.8;
  margin: 0 0 24px;
}

.draw-btn {
  display: inline-flex;
  padding: 12px 24px;
  background: #fff;
  color: #FF8C42;
  border: 1.5px solid #FF8C42;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s;
}

.draw-btn:hover {
  background: #FF8C42;
  color: #fff;
}

.draw-preview {
  flex-shrink: 0;
  width: 400px;
}

.preview-card {
  aspect-ratio: 4/3;
  background: #fff;
  border-radius: 20px;
  border: 2px dashed rgba(255, 140, 66, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-label {
  font-size: 14px;
  color: #ccc;
}

/* ===== 响应式 ===== */
@media (max-width: 968px) {
  .hero-inner {
    flex-direction: column;
    text-align: center;
  }

  .hero-content {
    max-width: 100%;
  }

  .hero-actions {
    justify-content: center;
  }

  .hero-hint {
    display: none;
  }

  .hero-card {
    order: -1;
  }

  .steps-grid {
    grid-template-columns: 1fr;
  }

  .draw-section .section-inner {
    flex-direction: column;
  }

  .draw-preview {
    width: 100%;
    max-width: 400px;
  }
}

@media (max-width: 640px) {
  .nav-links {
    display: none;
  }

  .hero-title {
    font-size: 28px;
  }

  .scan-card {
    width: 240px;
    padding: 20px;
  }
}
</style>
