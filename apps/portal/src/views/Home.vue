<template>
  <div class="home-page">
    <!-- 导航栏 -->
    <nav class="navbar">
      <div class="nav-content">
        <div class="logo">
          <h1>🎨 科豆 AI</h1>
        </div>
        <div class="nav-links">
          <router-link to="/" class="nav-link">首页</router-link>
          <router-link to="/draw" class="nav-link">画笔</router-link>
          <a href="#" class="nav-link">课程</a>
          <a href="#" class="nav-link">关于我们</a>
        </div>
        <div class="nav-actions">
          <template v-if="isLoggedIn">
            <a-dropdown>
              <span class="user-menu">
                <a-avatar :size="24" :src="userAvatar" style="margin-right: 8px" />
                {{ username }}
              </span>
              <template #overlay>
                <a-menu>
                  <a-menu-item key="profile">
                    <router-link to="/profile">个人中心</router-link>
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item key="logout" @click="handleLogout">退出登录</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </template>
          <template v-else>
            <router-link to="/login">
              <a-button type="primary">登录</a-button>
            </router-link>
          </template>
        </div>
      </div>
    </nav>

    <!-- Hero 区域 -->
    <section class="hero-section">
      <div class="hero-content">
        <h1 class="hero-title">开启孩子的 AI 学习之旅</h1>
        <p class="hero-subtitle">趣味课程 · 智能互动 · 快乐成长</p>
        <div class="hero-actions">
          <a-button type="primary" size="large" class="hero-btn">免费试听</a-button>
          <a-button size="large" class="hero-btn-outline">了解更多</a-button>
        </div>
      </div>
    </section>

    <!-- 课程卡片区域 -->
    <section class="courses-section">
      <div class="container">
        <h2 class="section-title">热门课程</h2>
        <div class="courses-grid">
          <div class="course-card" v-for="course in courses" :key="course.id">
            <div class="course-image">
              <img :src="course.image" :alt="course.title" />
            </div>
            <div class="course-info">
              <h3 class="course-title">{{ course.title }}</h3>
              <p class="course-desc">{{ course.description }}</p>
              <div class="course-meta">
                <span class="course-age">适合年龄：{{ course.ageRange }}</span>
                <span class="course-lessons">{{ course.lessons }} 课时</span>
              </div>
              <div class="course-footer">
                <span class="course-price">¥{{ course.price }}</span>
                <a-button type="primary" size="small">立即学习</a-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 特色功能 -->
    <section class="features-section">
      <div class="container">
        <h2 class="section-title">为什么选择科豆 AI</h2>
        <div class="features-grid">
          <div class="feature-item" v-for="feature in features" :key="feature.id">
            <div class="feature-icon">{{ feature.icon }}</div>
            <h3 class="feature-title">{{ feature.title }}</h3>
            <p class="feature-desc">{{ feature.description }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- 页脚 -->
    <footer class="footer">
      <div class="container">
        <p>&copy; 2024 科豆 AI. All rights reserved.</p>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUserStore } from '@/stores/user';
import { logout as logoutApi } from '@/api/auth';
import { message } from 'ant-design-vue';

const router = useRouter();
const userStore = useUserStore();

const DEFAULT_AVATAR = '/avatars/default-avatar.png';

const isLoggedIn = computed(() => !!userStore.token);
const username = computed(() => userStore.userInfo?.username || '');
const userAvatar = computed(() => userStore.userInfo?.avatar || DEFAULT_AVATAR);

onMounted(() => {
  userStore.initFromStorage();
});

async function handleLogout() {
  try {
    await logoutApi();
    message.success('已退出登录');
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    userStore.logout();
    router.push('/login');
  }
}

const courses = ref([
  {
    id: 1,
    title: 'AI 绘画启蒙',
    description: '让孩子用 AI 创作属于自己的艺术作品',
    ageRange: '6-12 岁',
    lessons: 20,
    price: 299,
    image: 'https://via.placeholder.com/300x200/667eea/ffffff?text=AI+Art',
  },
  {
    id: 2,
    title: '编程思维训练',
    description: '培养逻辑思维，轻松入门编程',
    ageRange: '8-15 岁',
    lessons: 30,
    price: 399,
    image: 'https://via.placeholder.com/300x200/764ba2/ffffff?text=Coding',
  },
  {
    id: 3,
    title: '创意写作',
    description: '激发想象力，写出精彩故事',
    ageRange: '7-14 岁',
    lessons: 24,
    price: 349,
    image: 'https://via.placeholder.com/300x200/667eea/ffffff?text=Writing',
  },
  {
    id: 4,
    title: '数学思维',
    description: '趣味数学，培养抽象思维',
    ageRange: '6-12 岁',
    lessons: 28,
    price: 329,
    image: 'https://via.placeholder.com/300x200/764ba2/ffffff?text=Math',
  },
]);

const features = ref([
  {
    id: 1,
    icon: '🎯',
    title: '个性化学习',
    description: 'AI 智能推荐，为每个孩子定制专属学习路径',
  },
  {
    id: 2,
    icon: '🎮',
    title: '趣味互动',
    description: '游戏化学习，让孩子在快乐中成长',
  },
  {
    id: 3,
    icon: '👨‍🏫',
    title: '专业师资',
    description: '资深教育专家团队，保证教学质量',
  },
  {
    id: 4,
    icon: '📊',
    title: '学习报告',
    description: '实时跟踪学习进度，家长随时掌握',
  },
]);
</script>

<style scoped>
.home-page {
  min-height: 100vh;
}

.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  padding: 15px 0;
}

.nav-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.logo h1 {
  font-size: 24px;
  color: #667eea;
  margin: 0;
}

.nav-links {
  display: flex;
  gap: 30px;
}

.nav-link {
  text-decoration: none;
  color: #333;
  font-weight: 500;
  transition: color 0.3s;
}

.nav-link:hover {
  color: #667eea;
}

.hero-section {
  padding: 120px 0 80px;
  text-align: center;
}

.hero-content {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 20px;
}

.hero-title {
  font-size: 48px;
  margin-bottom: 20px;
  font-weight: 700;
}

.hero-subtitle {
  font-size: 20px;
  margin-bottom: 40px;
  opacity: 0.9;
}

.hero-actions {
  display: flex;
  gap: 20px;
  justify-content: center;
}

.hero-btn {
  background: white;
  color: #667eea;
  border: none;
  font-weight: 600;
}

.hero-btn-outline {
  background: transparent;
  color: white;
  border: 2px solid white;
  font-weight: 600;
}

.courses-section {
  padding: 80px 0;
  background: #f8f9ff;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
}

.section-title {
  text-align: center;
  font-size: 36px;
  margin-bottom: 50px;
  color: #333;
}

.courses-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 30px;
}

.course-card {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  transition: transform 0.3s, box-shadow 0.3s;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.course-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}

.course-image img {
  width: 100%;
  height: 180px;
  object-fit: cover;
}

.course-info {
  padding: 20px;
}

.course-title {
  font-size: 18px;
  margin-bottom: 10px;
  color: #333;
}

.course-desc {
  font-size: 14px;
  color: #666;
  margin-bottom: 15px;
  line-height: 1.5;
}

.course-meta {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #999;
  margin-bottom: 15px;
}

.course-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.course-price {
  font-size: 20px;
  color: #667eea;
  font-weight: 700;
}

.features-section {
  padding: 80px 0;
  background: white;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 40px;
}

.feature-item {
  text-align: center;
  padding: 30px;
}

.feature-icon {
  font-size: 48px;
  margin-bottom: 20px;
}

.feature-title {
  font-size: 20px;
  margin-bottom: 15px;
  color: #333;
}

.feature-desc {
  font-size: 14px;
  color: #666;
  line-height: 1.6;
}

.footer {
  background: #2d3748;
  color: white;
  padding: 30px 0;
  text-align: center;
}
</style>
