<template>
  <div class="discover">
    <div class="chead">
      <h1>发现</h1>
      <span class="badge">选择一项能力开始</span>
    </div>

    <div class="pane">
      <!-- 空态：能力清单接口上线后（B2）才可能出现，写死期不可达，留作兜底出口 -->
      <div v-if="!CAPABILITIES.length" class="card empty">
        <div class="empty-ic"><app-icon name="inbox" size="lg" /></div>
        <h3>暂无可用能力</h3>
        <p>还没有为你开放的能力，可以直接描述问题，由 AI 自动判断该用哪项能力</p>
        <button type="button" class="btn-primary btn-sm" @click="router.push('/chat')">
          去对话
        </button>
      </div>

      <div v-else class="grid">
        <button
          v-for="c in CAPABILITIES"
          :key="c.name"
          type="button"
          class="card"
          :class="{ dim: !c.enabled }"
          @click="onCardClick(c)"
        >
          <span class="card-icon"><app-icon :name="c.icon" size="lg" /></span>
          <h3>{{ c.name }}</h3>
          <p>{{ c.desc }}</p>
          <span class="card-foot">
            <span class="tag" :class="{ ok: c.enabled }">{{ c.enabled ? '已启用' : '敬请期待' }}</span>
            <span v-if="c.enabled" class="card-go">开始使用<app-icon name="right" /></span>
            <span v-else class="card-go">—</span>
          </span>
        </button>
      </div>

      <div class="claim">
        能力清单由后台配置，上线进度以本页为准；未开放的能力点一下就知道什么时候能用。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import type { IconName } from '@/config/icons';
import AppIcon from '@/components/AppIcon.vue';

interface Capability {
  name: string;
  desc: string;
  icon: IconName;
  /** 未开放的能力没有落地页 */
  to: string;
  enabled: boolean;
}

/**
 * 能力清单（Q3 已拍板：数据源写死）——后端 B2（agent_definitions 展示元数据 + C 端清单接口）
 * 就绪后再换成接口数据。已启用两项即发现页的落地工作台：翻译 = /translate、合翻 = /contract。
 */
const CAPABILITIES: Capability[] = [
  {
    name: '语言翻译官',
    desc: '三版译文对照 + 语气点评，支持 12 种语言',
    icon: 'lang',
    to: '/translate',
    enabled: true,
  },
  {
    name: '合同翻译官',
    desc: '上传合同自动识别风险信号、法律依据与可争取权益',
    icon: 'doc',
    to: '/contract',
    enabled: true,
  },
  { name: '论文速读', desc: '上传论文，提取核心结论与方法', icon: 'search', to: '', enabled: false },
  { name: '文案改写', desc: '按平台与受众重写营销文案', icon: 'grid', to: '', enabled: false },
];

const router = useRouter();

/** 已启用 → 进能力工作台；未开放 → 可点但给明确反馈（不做灰字死卡） */
function onCardClick(c: Capability) {
  if (!c.enabled) {
    message.info('该能力尚未开放');
    return;
  }
  router.push(c.to);
}
</script>

<style scoped>
.discover {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 20px 32px 24px;
}

.chead {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 12px;
}

.chead h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.badge {
  height: 22px;
  padding: 0 8px;
  border-radius: var(--ws-radius-pill);
  font-size: 12px;
  font-weight: 500;
  background: var(--ws-bg-subtle);
  color: var(--ws-text-secondary);
  display: inline-flex;
  align-items: center;
}

.pane {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
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
  text-decoration: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.card:hover {
  border-color: var(--ws-brand-500);
  box-shadow: var(--ws-shadow-popover);
  transform: translateY(-2px);
}

/* 未开放：降饱和但**仍可点**（点击给 Toast，不做灰字死卡） */
.card.dim {
  background: var(--ws-bg-subtle);
  box-shadow: none;
}

.card.dim .card-icon {
  background: var(--ws-bg-subtle);
  color: var(--ws-text-tertiary);
}

.card.dim h3,
.card.dim p {
  color: var(--ws-text-tertiary);
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

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}

.tag {
  height: 22px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 500;
  background: var(--ws-bg-subtle);
  color: var(--ws-text-tertiary);
  display: inline-flex;
  align-items: center;
}

.tag.ok {
  background: var(--ws-success-100);
  color: var(--ws-success-500);
}

.card-go {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.empty {
  padding: 64px 24px;
  text-align: center;
  color: var(--ws-text-tertiary);
}

.empty-ic {
  margin: 0 auto 16px;
  color: var(--ws-brand-500);
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
}

.empty h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 4px;
}

.empty p {
  font-size: 13px;
  margin-bottom: 16px;
}

.claim {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-top: 16px;
  line-height: 1.8;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 16px;
  border-radius: var(--ws-radius-md);
  background: var(--ws-brand-500);
  color: var(--ws-brand-50);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s ease;
}

.btn-primary:hover {
  background: var(--ws-brand-600);
}

.btn-sm {
  height: 28px;
  padding: 0 12px;
  font-size: 13px;
}
</style>
