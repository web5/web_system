<!--
  B3 高级调参面板（五控件 + 三条联动 + 生效策略预览）
  真源：B3-原型说明.md §2/§3（Proto: 653631a0，Design: pass）、D1-think统一-技术方案修订.md §6.3
  视觉：D5 口径 —— 跟 admin 现行 --ws-* 工程端 token，不引入原型 Claymorphism 暗色
-->
<template>
  <div class="b3-tuning">
    <div class="b3-tuning-head">
      <span class="b3-tuning-title">高级调参</span>
      <a-tag v-if="hasTools" color="blue">带工具 · 强制 enabled 生效</a-tag>
      <a-tag v-else>非工具</a-tag>
      <a-tag class="b3-role-tag">仅超级管理员可编辑</a-tag>
    </div>

    <a-row :gutter="16">
      <a-col :span="12">
        <!-- 控件 1 · temperature：空 = 不覆盖，运行时回落 0.7（禁止 ?? 0.7 预填） -->
        <a-form-item
          label="Temperature"
          extra="留空 = 不覆盖，运行时回落 0.7；与 topP 互斥"
          :help="errs.temperature"
          :validate-status="errs.temperature ? 'error' : ''"
        >
          <a-input-number
            :value="temperature"
            :min="0"
            :max="2"
            :step="0.1"
            placeholder="未配置"
            style="width: 100%"
            @update:value="onTemperature"
          />
        </a-form-item>

        <!-- 控件 2 · maxTokens：占位随工具联动（联动②） -->
        <a-form-item
          label="输出上限 maxTokens"
          :extra="hasTools ? '带工具留空 = 模型上限，不人为压小' : '留空 = 系统默认'"
          :help="errs.maxTokens"
          :validate-status="errs.maxTokens ? 'error' : ''"
        >
          <a-input-number
            :value="maxTokens"
            :min="1"
            :precision="0"
            :placeholder="maxTokensPlaceholder(hasTools)"
            style="width: 100%"
            @update:value="onMaxTokens"
          />
        </a-form-item>

        <!-- 控件 3 · topP：与 temperature 互斥（C7-b）——同填保存被拒、红字、不清值 -->
        <a-form-item
          label="Top P"
          extra="核采样 top_p；与 temperature 互斥，同填保存将被拒绝"
          :help="errs.topP"
          :validate-status="errs.topP ? 'error' : ''"
        >
          <a-input-number
            :value="topP"
            :min="0"
            :max="1"
            :step="0.01"
            placeholder="未配置"
            style="width: 100%"
            @update:value="onTopP"
          />
        </a-form-item>
      </a-col>

      <a-col :span="12">
        <!-- 控件 4 · thinking：三态 segmented（D1） -->
        <a-form-item
          label="thinking"
          extra='未配置 = 走优先级链；enabled / disabled 显式覆盖。budget_tokens 不进 agent 配置'
        >
          <a-radio-group
            :value="thinkingVal"
            option-type="button"
            :options="thinkingOptions"
            @change="onThinking"
          />
        </a-form-item>

        <!-- 联动③：thinking=enabled → budget 只读预览（实时重算） -->
        <div v-if="thinkingVal === 'enabled'" class="b3-budget-preview">
          思考预算（只读预览）= <b>{{ preview.budgetTokens }}</b>
          <span class="b3-formula">{{ preview.budgetFormula }}</span>
        </div>

        <!-- 控件 5 · max_steps（已有列，随本表单露出） -->
        <a-form-item
          label="最大步数 max_steps"
          extra="Agent 引擎最大工具编排轮数"
          :help="errs.maxSteps"
          :validate-status="errs.maxSteps ? 'error' : ''"
        >
          <a-input-number
            :value="maxStepsVal"
            :min="1"
            :max="50"
            :precision="0"
            style="width: 100%"
            @update:value="onMaxSteps"
          />
        </a-form-item>

        <!-- 联动①：挂工具误配 disabled → 红字警示（D2 可点+警示，不锁死控件） -->
        <a-alert
          v-if="misconfig"
          class="b3-misconfig"
          type="error"
          show-icon
          message="该 Agent 挂载工具，thinking 将被强制启用"
          description="按 D1 拍板（双保险 + 强制侧）：装配侧检测到带工具且未显式 enabled 时强制 enabled——此处选 disabled 不会生效，运行时会被纠正。"
        />
      </a-col>
    </a-row>

    <!-- 生效策略预览（轻量版）：P1–P5 命中档实时标注 + 三值输出 -->
    <div class="b3-strategy">
      <div class="b3-strategy-title">生效策略预览</div>
      <a-row :gutter="16">
        <a-col :span="12">
          <ul class="b3-chain">
            <li v-for="item in preview.chain" :key="item.no" :class="{ 'b3-hit': item.hit }">
              <span class="b3-p-no">P{{ item.no }}</span>
              <span class="b3-p-label">{{ item.label }}</span>
              <span class="b3-p-state">{{ item.detail }}</span>
            </li>
          </ul>
        </a-col>
        <a-col :span="12">
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
        </a-col>
      </a-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  maxTokensPlaceholder,
  isThinkingMisconfig,
  buildStrategyPreview,
  type ThinkingFormValue,
} from '@/utils/tuning-params';

const temperature = defineModel<number | null>('temperature');
const maxTokens = defineModel<number | null>('maxTokens');
const topP = defineModel<number | null>('topP');
const thinking = defineModel<ThinkingFormValue>('thinking');
const maxSteps = defineModel<number>('maxSteps');

const props = defineProps<{
  /** 是否挂载工具（tools / capabilities 非空） */
  hasTools: boolean;
  /** 保存校验错误（C7-b 等），字段级红字 */
  errors?: Partial<Record<'temperature' | 'maxTokens' | 'topP' | 'maxSteps', string>>;
}>();

const errs = computed(() => props.errors ?? {});

const thinkingOptions = [
  { label: '未配置 (NULL)', value: 'null' },
  { label: 'enabled', value: 'enabled' },
  { label: 'disabled', value: 'disabled' },
];

/** 归一化读值（defineModel 可能为 undefined） */
const thinkingVal = computed<ThinkingFormValue>(() => thinking.value ?? 'null');
const maxStepsVal = computed<number>(() => maxSteps.value ?? 10);

function onTemperature(v: number | null | undefined) {
  // 空值保持「未配置」（null），禁止 ?? 0.7 预填（D10 修正）
  temperature.value = v ?? null;
}
function onMaxTokens(v: number | null | undefined) {
  maxTokens.value = v ?? null;
}
function onTopP(v: number | null | undefined) {
  topP.value = v ?? null;
}
function onMaxSteps(v: number | null | undefined) {
  if (v !== null && v !== undefined) maxSteps.value = v;
}
function onThinking(e: { target: { value: ThinkingFormValue } }) {
  thinking.value = e.target.value;
}

const misconfig = computed(() => isThinkingMisconfig(props.hasTools, thinkingVal.value));

const preview = computed(() =>
  buildStrategyPreview({
    hasTools: props.hasTools,
    thinking: thinkingVal.value,
    maxTokens: maxTokens.value ?? null,
  }),
);
</script>

<style scoped>
.b3-tuning {
  padding: 16px 0 12px;
  margin-top: 4px;
  border-top: 1px solid var(--ws-border-subtle, #ebebeb);
}
.b3-tuning-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.b3-tuning-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--ws-text-primary, #1a1a1a);
}
.b3-role-tag {
  margin-left: auto;
}
.b3-budget-preview {
  margin: -8px 0 16px;
  padding: 8px 12px;
  background: var(--ws-bg-subtle, #f2f2f2);
  border: 1px solid var(--ws-border-subtle, #ebebeb);
  border-radius: var(--ws-radius-sm, 6px);
  font-size: 12px;
  color: var(--ws-text-secondary, #525252);
}
.b3-budget-preview b {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.b3-formula {
  margin-left: 6px;
  font-size: 12px;
  color: var(--ws-text-secondary, #525252);
}
.b3-misconfig {
  margin-bottom: 16px;
}
.b3-strategy {
  margin-top: 8px;
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
}
.b3-out b {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--ws-text-primary, #1a1a1a);
}
</style>
