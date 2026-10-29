<!--
  生效策略预览（整宽）：P1–P5 优先级链命中档实时标注 + thinking / budget_tokens / max_tokens 三值输出
  真源：B3-原型说明.md §3（Proto: 653631a0，Design: pass）、D1-think统一-技术方案修订.md
  2026-10-29 拍板（A）：从 AgentTuningPanel 抽出、整宽渲染——原困在外层 a-col span=12（505px）
  内再被面板挤压，P1–P5 链与三值输出全部折行；现置于「参数面板 + 调试台」a-row 之后。
  真值数据同源：thinking / maxTokens 与 AgentTuningPanel 收到的 props 一致（父组件透传）。
-->
<template>
  <div class="b3-strategy">
    <div class="b3-strategy-title">生效策略预览</div>
    <div class="b3-strategy-cols">
      <ul class="b3-chain">
        <li v-for="item in preview.chain" :key="item.no" :class="{ 'b3-hit': item.hit }">
          <span class="b3-p-no">P{{ item.no }}</span>
          <span class="b3-p-label">{{ item.label }}</span>
          <span class="b3-p-state">{{ item.detail }}</span>
        </li>
      </ul>
      <div class="b3-out">
        <div>thinking → <b>{{ preview.thinkingText }}</b></div>
        <div>
          budget_tokens →
          <b>{{ preview.budgetTokens === null ? '不下发' : preview.budgetTokens }}</b>
          <span v-if="preview.budgetFormula" class="b3-formula">{{ preview.budgetFormula }}</span>
        </div>
        <div>
          max_tokens → <b>{{ preview.maxTokens }}</b>
          <span class="b3-formula">{{ preview.maxTokensWhy }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { buildStrategyPreview, type ThinkingFormValue } from '@/utils/tuning-params';

const props = defineProps<{
  /** 是否挂载工具（与 AgentTuningPanel 的 has-tools 同源） */
  hasTools: boolean;
  /** thinking 三态（与 AgentTuningPanel 的 thinking 同源） */
  thinking: ThinkingFormValue;
  /** 输出上限（与 AgentTuningPanel 的 max-tokens 同源；null = 未配置） */
  maxTokens: number | null;
}>();

const preview = computed(() =>
  buildStrategyPreview({
    hasTools: props.hasTools,
    thinking: props.thinking,
    maxTokens: props.maxTokens ?? null,
  }),
);
</script>

<style scoped>
.b3-strategy {
  margin-top: 12px;
  padding: 12px 16px;
  background: var(--ws-bg-subtle, #f2f2f2);
  border: 1px solid var(--ws-border-subtle, #ebebeb);
  border-radius: var(--ws-radius-md, 8px);
}
.b3-strategy-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 8px;
  color: var(--ws-text-primary, #1a1a1a);
}
/* 整宽区域内部左右分栏：左 P1–P5 链 / 右三值输出；窄时自动堆叠（与原型 .strat-cols 同口径） */
.b3-strategy-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  align-items: start;
}
.b3-chain {
  list-style: none;
  margin: 0;
  padding: 0;
}
.b3-chain li {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 22px;
  color: var(--ws-text-secondary, #525252);
}
.b3-chain li.b3-hit {
  color: var(--ws-text-primary, #1a1a1a);
}
.b3-p-no {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  width: 22px;
  flex-shrink: 0;
}
.b3-p-label {
  flex: 1;
}
.b3-p-state {
  color: var(--ws-text-secondary, #525252);
}
.b3-chain li.b3-hit .b3-p-state {
  color: var(--ws-brand-600, #ea580c);
  font-weight: 600;
}
.b3-out {
  font-size: 12px;
  line-height: 22px;
  color: var(--ws-text-secondary, #525252);
  border-top: 1px dashed var(--ws-border-subtle, #ebebeb);
  padding-top: 8px;
}
.b3-out b {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ws-text-primary, #1a1a1a);
}
.b3-formula {
  margin-left: 6px;
  font-size: 12px;
  color: var(--ws-text-secondary, #525252);
}
</style>
