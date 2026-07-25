<template>
  <nav class="app-navbar">
    <div class="nav-inner">
      <!-- Logo：科豆 AI（主品牌）+ 变变（子产品标识） -->
      <router-link to="/" class="nav-brand">
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
        <div class="brand-text">
          <span class="brand-name">科豆 AI</span>
          <span class="brand-sub">变变 · AI 拼贴变身</span>
        </div>
      </router-link>

      <!-- 汉堡按钮（移动端） -->
      <button class="hamburger" @click="menuOpen = !menuOpen" :class="{ open: menuOpen }">
        <span></span><span></span><span></span>
      </button>

      <!-- 导航链接（桌面端） -->
      <div class="nav-links">
        <router-link to="/" class="nav-link" exact-active-class="active">首页</router-link>
        <router-link to="/bianbian" class="nav-link" active-class="active">变变</router-link>
        <router-link to="/draw" class="nav-link" active-class="active">画板</router-link>
        <router-link to="/chat" class="nav-link" active-class="active">AI 助手</router-link>
        <router-link to="/todo" class="nav-link" active-class="active">Todo</router-link>
        <router-link to="/tools" class="nav-link" active-class="active">工具箱</router-link>
      </div>

      <!-- 用户信息（桌面端） -->
      <div class="nav-right">
        <template v-if="userStore.isLoggedIn">
          <span class="nav-user" @click="$router.push('/profile')">
            <span class="user-avatar">
              <img :src="avatarSrc" class="avatar-img" />
            </span>
            <span class="user-name">{{ userStore.userInfo?.username }}</span>
          </span>
          <button class="btn-logout" @click="handleLogout">退出</button>
        </template>
        <router-link v-else :to="`/login?redirect=${$route.path}`" class="btn-login">登录</router-link>
      </div>
    </div>

    <!-- 移动端遮罩 -->
    <div class="mobile-overlay" :class="{ open: menuOpen }" @click="menuOpen = false"></div>

    <!-- 移动端侧边栏 -->
    <div class="mobile-drawer" :class="{ open: menuOpen }">
      <div class="mobile-drawer-header">
        <router-link to="/" class="mobile-drawer-brand" @click="menuOpen = false">
          <svg viewBox="0 0 210 110" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="210" height="110" rx="55" fill="#f97316"/>
            <path d="M 105 18 C 127 18, 139 34, 139 60 C 139 90, 121 102, 105 102 C 87 102, 71 88, 71 60 C 71 32, 87 18, 105 18 Z" fill="white"/>
            <circle cx="105" cy="60" r="9" fill="#f97316"/>
            <circle cx="105" cy="58" r="3.5" fill="#FDE68A"/>
            <path d="M 105 18 Q 105 10, 105 7" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
            <circle cx="105" cy="6" r="3.5" fill="white"/>
          </svg>
          <div class="brand-text">
            <span class="brand-name">科豆 AI</span>
            <span class="brand-sub">变变 · AI 拼贴变身</span>
          </div>
        </router-link>
        <button class="mobile-close-btn" @click="menuOpen = false">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="mobile-links">
        <router-link to="/" class="mobile-link" exact-active-class="active" @click="menuOpen = false">首页</router-link>
        <router-link to="/bianbian" class="mobile-link" active-class="active" @click="menuOpen = false">变变</router-link>
        <router-link to="/draw" class="mobile-link" active-class="active" @click="menuOpen = false">画板</router-link>
        <router-link to="/chat" class="mobile-link" active-class="active" @click="menuOpen = false">AI 助手</router-link>
        <router-link to="/todo" class="mobile-link" active-class="active" @click="menuOpen = false">Todo</router-link>
        <router-link to="/tools" class="mobile-link" active-class="active" @click="menuOpen = false">工具箱</router-link>
      </div>

      <div class="mobile-user">
        <template v-if="userStore.isLoggedIn">
          <span class="nav-user" @click="$router.push('/profile'); menuOpen = false">
            <span class="user-avatar">
              <img :src="avatarSrc" class="avatar-img" />
            </span>
            <span class="user-name">{{ userStore.userInfo?.username }}</span>
          </span>
          <button class="btn-logout" @click="handleLogout">退出</button>
        </template>
        <router-link v-else :to="`/login?redirect=${$route.path}`" class="btn-login" @click="menuOpen = false">登录</router-link>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const menuOpen = ref(false);

const avatarSrc = computed(() => {
  const info = userStore.userInfo;
  if (info?.avatar) return info.avatar;
  return info?.gender === 'female' ? '/avatars/default-female.png' : '/avatars/default-male.png';
});

function handleLogout() {
  userStore.logout();
  message.success('已退出登录');
  menuOpen.value = false;
  router.push(route.path);
}
</script>

<style scoped>
.app-navbar {
  background: #FFFFFF;
  border-bottom: 1px solid #EEEEEE;
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-inner {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 64px;
}

/* ===== Logo ===== */
.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  flex-shrink: 0;
}

.brand-logo {
  width: 36px;
  height: 19px;
  display: flex;
  align-items: center;
}

.brand-logo svg {
  width: 100%;
  height: 100%;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  gap: 2px;
}

.brand-name {
  font-size: 18px;
  font-weight: 700;
  color: #333;
  letter-spacing: 0.5px;
}

.brand-sub {
  font-size: 10px;
  color: #999;
  font-weight: 500;
  letter-spacing: 0.2px;
}

/* ===== 导航链接 ===== */
.nav-links {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-link {
  color: #666;
  text-decoration: none;
  font-size: 14px;
  padding: 8px 14px;
  border-radius: 8px;
  transition: all 0.2s;
  font-weight: 500;
}

.nav-link:hover {
  color: #FF8C42;
  background: #FFF8F0;
}

/* 用 :deep 提升特异性，并使用 router-link 自动添加的 active 类 */
.nav-link:deep(.active),
.nav-link.active {
  color: #FF8C42;
  background: #FFF8F0;
  font-weight: 600;
}

/* ===== 用户区域 ===== */
.nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.nav-user {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.nav-user:hover { background: #f5f5f5; }

.user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #FF8C42;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-icon {
  width: 16px;
  height: 16px;
  color: white;
}

.user-name {
  font-size: 14px;
  color: #333;
  font-weight: 500;
}

.btn-login {
  padding: 6px 16px;
  background: #FF8C42;
  color: #FFFFFF;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.2s;
}

.btn-login:hover { background: #e67e3a; }

.btn-logout {
  padding: 4px 8px;
  background: none;
  color: #999;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: color 0.2s;
}

.btn-logout:hover {
  color: #FF4444;
  background: none;
}

/* ===== 汉堡按钮 ===== */
.hamburger {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 36px;
  height: 36px;
  padding: 6px;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.2s;
}

.hamburger:hover { background: #f5f5f5; }

.hamburger span {
  display: block;
  width: 20px;
  height: 2px;
  background: #333;
  border-radius: 2px;
  transition: all 0.3s;
}

.hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.hamburger.open span:nth-child(2) { opacity: 0; }
.hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

/* ===== 移动端侧边栏 ===== */
.mobile-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.4);
  z-index: 199;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.mobile-overlay.open {
  display: block;
  opacity: 1;
  pointer-events: auto;
}

.mobile-drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  width: 280px;
  max-width: 80vw;
  background: #FFFFFF;
  z-index: 200;
  transform: translateX(-100%);
  transition: transform 0.3s ease;
  display: flex;
  flex-direction: column;
  padding: 20px;
}

.mobile-drawer.open {
  transform: translateX(0);
}

.mobile-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #EEEEEE;
}

.mobile-drawer-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
}

.mobile-drawer-brand svg {
  width: 32px;
  height: auto;
  flex-shrink: 0;
}

.mobile-drawer-brand .brand-name {
  font-size: 16px;
}

.mobile-drawer-brand .brand-sub {
  font-size: 10px;
}

.mobile-close-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mobile-close-btn:hover { background: #f5f5f5; }

.mobile-links {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mobile-link {
  color: #666;
  text-decoration: none;
  font-size: 15px;
  padding: 12px 16px;
  border-radius: 8px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 500;
}

.mobile-link:hover {
  color: #FF8C42;
  background: #FFF8F0;
}

.mobile-link:deep(.active),
.mobile-link.active {
  color: #FF8C42;
  background: #FFF8F0;
  font-weight: 600;
}

.mobile-user {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid #EEEEEE;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ===== 响应式 ===== */
@media (max-width: 768px) {
  .nav-inner { padding: 0 12px; }
  .nav-links { display: none; }
  .nav-right { display: none; }
  .hamburger { display: flex; }
  .brand-sub { display: none; } /* 移动端隐藏副标题 */
}

@media (max-width: 480px) {
  .brand-text { display: none; }
}
</style>
