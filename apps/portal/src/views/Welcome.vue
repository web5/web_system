<template>
  <div class="welcome">
    <h1 class="hello">Hello<span class="dot">.</span></h1>
    <p class="sub">科豆 AI · 体验不一样的 AI</p>

    <button type="button" class="cta" @click="startChat">
      <app-icon name="chat" size="lg" />
      <span>开始对话</span>
    </button>

    <section class="daily">
      <div class="daily-head">
        <span class="daily-label">今日一句</span>
        <button type="button" class="daily-change" @click="changeQuote">
          <app-icon name="refresh" />
          <span>换一句</span>
        </button>
      </div>
      <p class="daily-cn">{{ quote.cn }}</p>
      <p class="daily-en">{{ quote.en }}</p>
    </section>

    <p class="claim">
      内容由 AI 生成，仅供参考，不构成法律意见<br />
      已依法完成大模型与算法备案
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { dayIndex, getDailyQuote, nextQuote, type DailyQuote } from '@/config/daily';
import { useConversationStore } from '@/stores/conversations';
import AppIcon from '@/components/AppIcon.vue';

const router = useRouter();
const store = useConversationStore();

const index = ref(dayIndex());
const quote = ref<DailyQuote>(getDailyQuote());

function changeQuote() {
  const next = nextQuote(index.value);
  index.value = next.index;
  quote.value = next.quote;
}

/** 开始对话：开启新会话（左栏不选中任何记录） */
function startChat() {
  store.startNew();
  router.push('/chat');
}
</script>

<style scoped>
.welcome {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 48px 24px;
  /* 品牌橙光斑：左上 / 右下两团，只做视觉呼吸感，不加信息 */
  background:
    radial-gradient(520px 260px at 12% 8%, var(--ws-brand-50) 0%, transparent 70%),
    radial-gradient(560px 280px at 88% 92%, var(--ws-brand-50) 0%, transparent 70%);
}

.hello {
  font-size: 44px;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: -1px;
  color: var(--ws-text-primary);
}

.dot {
  color: var(--ws-brand-500);
}

.sub {
  margin-top: 8px;
  font-size: 15px;
  color: var(--ws-text-secondary);
}

.cta {
  margin-top: 24px;
  height: 48px;
  padding: 0 28px;
  font-size: 15px;
  font-weight: 600;
  border-radius: var(--ws-radius-md);
  background: var(--ws-brand-500);
  color: var(--ws-brand-50);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 0.15s ease;
}

.cta:hover {
  background: var(--ws-brand-600);
}

/* 每日一句：阅读限宽 560px（page-spec §0） */
.daily {
  margin-top: 56px;
  max-width: 560px;
}

.daily-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
}

.daily-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-brand-700);
}

.daily-change {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--ws-radius-md);
  font-size: 13px;
  color: var(--ws-text-secondary);
  background: transparent;
  transition: background 0.15s ease, color 0.15s ease;
}

.daily-change:hover {
  background: var(--ws-bg-hover);
  color: var(--ws-brand-700);
}

.daily-cn {
  font-size: 20px;
  font-weight: 500;
  line-height: 1.7;
  color: var(--ws-text-primary);
}

.daily-en {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ws-text-tertiary);
}

.claim {
  margin-top: 48px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--ws-text-tertiary);
}
</style>
