<template>
  <div class="lab">
    <header class="work-hd">
      <div>
        <h1>实验室</h1>
        <span class="tag">实验性功能，不保证持续维护</span>
      </div>
    </header>

    <div class="pane">
      <section v-for="group in GROUPS" :key="group.name" class="sec">
        <h2 class="sec-title">{{ group.name }}</h2>
        <div class="grid">
          <button
            v-for="item in group.items"
            :key="item.to"
            type="button"
            class="card"
            @click="router.push(item.to)"
          >
            <span class="card-icon"><app-icon :name="item.icon" size="lg" /></span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.desc }}</p>
            <span class="card-foot">
              <span class="tag">实验性</span>
              <span class="card-go">打开<app-icon name="right" /></span>
            </span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import type { IconName } from '@/config/icons';
import AppIcon from '@/components/AppIcon.vue';

const router = useRouter();

interface LabItem {
  title: string;
  desc: string;
  icon: IconName;
  to: string;
}

/** 降级入口（design §2.2）：变变改名「秀秀」，主导航移除、代码保留 */
const GROUPS: Array<{ name: string; items: LabItem[] }> = [
  {
    name: '创作',
    items: [
      { title: '秀秀', desc: '图片拼贴 + AI 变身', icon: 'grid', to: '/lab/bianbian' },
      { title: '创意画板', desc: '自由绘画与 AI 生成', icon: 'brush', to: '/lab/draw' },
      { title: '我的相册', desc: '历史作品浏览', icon: 'photo', to: '/lab/album' },
    ],
  },
  {
    name: '效率工具',
    items: [
      { title: '在线工具箱', desc: 'JSON / SQL / 代码对比', icon: 'tools', to: '/lab/tools' },
      { title: 'Todo', desc: '待办清单', icon: 'todo', to: '/lab/todo' },
    ],
  },
];
</script>

<style scoped>
.lab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.work-hd {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-bg-surface);
}

.work-hd h1 {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ws-text-primary);
}

.tag {
  display: inline-block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px;
}

.sec {
  margin-bottom: 24px;
}

.sec-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-tertiary);
  letter-spacing: 0.02em;
  margin-bottom: 8px;
  padding-left: 4px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.card {
  padding: 20px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--ws-bg-surface);
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-lg);
  box-shadow: var(--ws-shadow-card);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.card:hover {
  border-color: var(--ws-brand-500);
  box-shadow: var(--ws-shadow-popover);
  transform: translateY(-2px);
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--ws-radius-md);
  background: var(--ws-brand-50);
  color: var(--ws-brand-700);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.card h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.card p {
  font-size: 13px;
  color: var(--ws-text-secondary);
  flex: 1;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.card-go {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
