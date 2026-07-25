<template>
  <div class="tools-page">
    <div class="tools-container">
      <!-- 头部 -->
      <header class="tools-header">
        <h1 class="tools-title">在线工具箱</h1>
        <p class="tools-subtitle">轻量 · 开发者好帮手</p>
        <div class="title-divider"></div>
      </header>

      <!-- 工具网格 -->
      <div class="tool-grid">
        <router-link v-for="tool in tools" :key="tool.path" :to="tool.path" class="tool-card" :class="{ disabled: tool.disabled }">
          <div class="tool-icon" v-html="tool.icon"></div>
          <div class="tool-name">{{ tool.name }}</div>
          <span class="tool-badge">{{ tool.badge }}</span>
          <span v-if="tool.disabled" class="tool-status wip">⏳ 建设中</span>
        </router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const tools = [
  {
    name: 'JSON 格式化',
    path: '/tools/json',
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FF8C42" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M9 12h6"/><path d="M9 15h4"/></svg>`,
    badge: 'Pretty',
    disabled: false,
  },
  {
    name: 'SQL 美化',
    path: '/tools/sql',
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4ECDC4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6c0 1.657 3.582 3 8 3s8-1.343 8-3"/><path d="M4 6v12c0 1.657 3.582 3 8 3s8-1.343 8-3V6"/><path d="M4 12c0 1.657 3.582 3 8 3s8-1.343 8-3"/></svg>`,
    badge: 'Formatter',
    disabled: false,
  },
  {
    name: '代码压缩',
    path: '/tools/uglify',
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7ED957" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><path d="M6 6h.01M6 18h.01"/></svg>`,
    badge: 'Uglify',
    disabled: false,
  },
  {
    name: '代码对比',
    path: '/tools/diff',
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8884FF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="4" y1="7" x2="9" y2="12"/><line x1="4" y1="12" x2="9" y2="12"/></svg>`,
    badge: 'Diff',
    disabled: false,
  },
  {
    name: '数据表格',
    path: '',
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`,
    badge: 'Table',
    disabled: true,
  },
  {
    name: '拖拽交互',
    path: '',
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5v.01M12 5v.01M19 5v.01M5 12v.01M12 12v.01M19 12v.01M5 19v.01M12 19v.01M19 19v.01"/></svg>`,
    badge: 'Drag',
    disabled: true,
  },
];
</script>

<style scoped>
.tools-page {
  min-height: calc(100vh - 64px);
  background: linear-gradient(180deg, #FFFBF5 0%, #F6F8FC 100%);
  padding: 3rem 1.5rem 4rem;
}

.tools-container {
  max-width: 1200px;
  margin: 0 auto;
}

/* 头部 */
.tools-header {
  text-align: center;
  margin-bottom: 3rem;
  padding: 1rem 0;
}

.tools-title {
  font-size: 2.2rem;
  font-weight: 700;
  color: #333;
  letter-spacing: -0.02em;
  margin: 0;
}

.tools-subtitle {
  font-size: 1rem;
  color: #888;
  margin-top: 0.4rem;
  font-weight: 400;
}

.title-divider {
  margin: 1rem auto 0;
  width: 60px;
  height: 4px;
  background: linear-gradient(90deg, #FF8C42, #FFB347);
  border-radius: 4px;
}

/* 工具网格 */
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1.5rem;
}

.tool-card {
  background: #ffffff;
  border-radius: 24px;
  padding: 1.8rem 1.2rem 1.5rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.02);
  transition: all 0.25s ease;
  border: 1px solid #f1f5f9;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  text-decoration: none;
  position: relative;
  user-select: none;
}

.tool-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.07), 0 4px 12px rgba(0, 0, 0, 0.03);
  border-color: #fde68a;
}

.tool-card:active {
  transform: scale(0.98);
}

.tool-card.disabled {
  opacity: 0.75;
  cursor: not-allowed;
  filter: grayscale(0.2);
}

.tool-card.disabled:hover {
  transform: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.04);
  border-color: #f1f5f9;
}

.tool-icon {
  width: 68px;
  height: 68px;
  background: #fff7ed;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
  transition: background 0.2s;
}

.tool-card:hover .tool-icon {
  background: #ffedd5;
}

.tool-name {
  font-size: 1.1rem;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 0.25rem;
  letter-spacing: 0.2px;
}

.tool-badge {
  font-size: 0.7rem;
  font-weight: 500;
  padding: 0.2rem 0.7rem;
  border-radius: 30px;
  background: #f1f5f9;
  color: #475569;
  margin-top: 0.4rem;
  display: inline-block;
  letter-spacing: 0.3px;
}

.tool-status.wip {
  background: #fef3c7;
  color: #b45309;
  font-size: 0.7rem;
  font-weight: 500;
  padding: 0.2rem 0.7rem;
  border-radius: 30px;
  margin-top: 0.3rem;
}

/* 响应式 */
@media (max-width: 640px) {
  .tools-page {
    padding: 2rem 1rem 3rem;
  }

  .tools-title {
    font-size: 1.8rem;
  }

  .tool-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1rem;
  }

  .tool-card {
    padding: 1.4rem 0.8rem 1.2rem;
  }

  .tool-icon {
    width: 56px;
    height: 56px;
  }
}

@media (max-width: 380px) {
  .tool-grid {
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  }
}
</style>
