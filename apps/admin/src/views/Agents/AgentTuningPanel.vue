<!--
  B3 高级调参面板（五控件 + 三条联动，单列）
  真源：B3-原型说明.md §2/§3（Proto: 653631a0，Design: pass）、D1-think统一-技术方案修订.md §6.3
  视觉：D5 口径 —— 跟 admin 现行 --ws-* 工程端 token，不引入原型 Claymorphism 暗色
  2026-10-29 拍板（A）：内部改单列顺序堆叠——原在外层 a-col span=12（505px）里再嵌
  a-row 12/12 双重挤压，输入框仅 235px；生效策略预览已抽至 AgentStrategyPreview.vue 整宽。
  2026-10-29 拍板（label 对齐）：五个 a-form-item 曾游离在 form 上下文外，antd 回落
  horizontal 且 label 列宽自适应文字宽 → 四控件左缘参差。按 page-spec §3.2 落地
  label 左置 + 固定 84px（原型 :215-216 口径）；曾试 layout="vertical"，属被否掉的上一版。
-->
<template>
  <div class="b3-tuning">
    <div class="b3-tuning-head">
      <span class="b3-tuning-title">高级调参</span>
      <a-tag v-if="hasTools" color="blue">带工具 · 强制 enabled 生效</a-tag>
      <a-tag v-else>非工具</a-tag>
      <a-tag class="b3-role-tag">仅管理员及以上可编辑</a-tag>
    </div>

    <!-- 2026-10-29 拍板（口径修正）：五个 a-form-item 曾游离在 form 上下文外，
         antd 回落 horizontal 且 label 列宽**自适应文字宽** → 四个数值输入左缘参差
         （实测 349/398/303/397，最大差 95px）。按 page-spec §3.2 定稿口径落地：
         label 左置、**固定 84px**、控件左缘对齐（原型 :215-216 / :221 .flb{flex:0 0 84px}）。
         曾试过 layout="vertical"，属**被否掉的上一版**（原型注释明写「上一版 label 上置…
         每字段 3 行、一堆小字」），已回退，勿再改回。
         :model="{}" 仅为补齐 form 上下文；字段值仍走 defineModel 直连父组件，不经 model。
         wrapper-col flex:'1 1 0'：antd 行是 flex-wrap:wrap，control 用 basis:auto 时基线尺寸取
         内容 max-content——thinking 行 extra 文案实测 535px > 可用 485px，整块 control 被
         折到下一行、左缘退回行首（2026-10-29 dev 实测 253 vs 其余 337）。basis 归 0 后
         control 恒占 label 之外的全部剩余宽，五行左缘恒等。 -->
    <a-form
      layout="horizontal"
      label-align="right"
      :colon="false"
      :label-col="{ style: { width: '84px' } }"
      :wrapper-col="{ style: { flex: '1 1 0', minWidth: 0 } }"
      :model="{}"
    >
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

      <!-- 控件 2 · maxTokens：占位统一「未配置」（B1，2026-10-29 拍板）；上限语义只在 extra -->
      <a-form-item
        label="输出上限 maxTokens"
        :extra="hasTools ? `留空 = 模型上限（${MODEL_MAX_TOKENS}），不人为压小` : '留空 = 系统默认'"
        :help="errs.maxTokens"
        :validate-status="errs.maxTokens ? 'error' : ''"
      >
        <a-input-number
          :value="maxTokens"
          :min="1"
          :precision="0"
          placeholder="未配置"
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

      <!-- 控件 5 · max_steps -->
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
    </a-form>

    <!-- 联动①：挂工具误配 disabled → 红字警示（D2 可点+警示，不锁死控件） -->
    <a-alert
      v-if="misconfig"
      class="b3-misconfig"
      type="error"
      show-icon
      message="该 Agent 挂载工具，thinking 将被强制启用"
      description="按 D1 拍板（双保险 + 强制侧）：装配侧检测到带工具且未显式 enabled 时强制 enabled——此处选 disabled 不会生效，运行时会被纠正。"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  MODEL_MAX_TOKENS,
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

/** 联动③：thinking=enabled 时思考预算只读预览（策略链/三值输出已抽至 AgentStrategyPreview） */
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
/* label 列：固定 84px、**右对齐**（label-align="right"，2026-10-29 用户追加拍板）、无冒号
   （:colon="false"，原型 .flb 无冒号）。antd horizontal 默认 nowrap，84px 里长 label
   会被截断 → 这里纠正为可换行：行高 20px + 上内距 6px，单行时文字在 32px 控件高度内
   视觉居中，换代后自然向下撑开（实测两行 46px < 行高 56px，不溢出、不压控件）。
   justify-content: flex-end —— antd 的 <label> 是 inline-flex 容器（flex 项按
   justify-content 排，text-align 管不到容器内文字；默认 normal≈flex-start），
   右对齐时文字仍贴在内容盒左缘 → 五个 label 文本右缘不齐（实测 335/325/319/319/323）、
   最长那条还会溢出内盒贴到控件（「Temperature」文本 82px > 内容盒，右缘 335 vs 控件 337
   只剩 2px）。显式 flex-end 后每行文字都靠内容右缘，五个右缘恒等（实测 349-12=337）。
   换行仍走继承的 text-align:end（label-align="right" 由 antd 落在 .ant-form-item-label 上），
   长 label 两行都右对齐，不出现「首行右、次行左」。
   ⚠️ flex-end 必须收进 min-width:576px 守卫，不能无条件写：<576px 时 ant-design-vue
   **会自动切上置**（es/form/style/index.js:380 的 @media(max-width: screenXSMax=575px)
   → makeVerticalLayout :337-356，label/control 各 flex:0 0 100% 各占满一行；它挂在
   genVerticalStyle 顶层返回对象里、被 genComponentStyleHook 无条件导出，对 horizontal
   也生效；screenXSMax = screenSM - 1 = 575，见 es/theme/util/alias.js:29）。上置态由
   makeVerticalLayoutLabel(:328-336) 设 text-align:start 要求**左**对齐；而 justify-content
   作用在 <label> 这个 inline-flex 容器内部、不受 text-align 管辖 → 无条件 flex-end 会把
   上置态的 label 推到行尾。 */
.b3-tuning :deep(.ant-form-item-label > label) {
  height: auto;
  white-space: normal;
  line-height: 20px;
  padding-top: 6px;
}
@media (min-width: 576px) {
  .b3-tuning :deep(.ant-form-item-label > label) {
    justify-content: flex-end;
  }
}
/* antd 的冒号位：:colon="false" 只把 ::after 的 content 换成空格，**margin: 0 8px 0 2px 仍在**
   ——它在 inline-flex 里是一个真实的 flex 项，右对齐时占住末尾 10px，文字右缘被顶到
   327 而非列右缘 337（2026-10-29 实测定位）。显式清掉，五个 label 文本右缘才统一落在
   列右缘（337），与控件左缘（349）拉开 12px。 */
.b3-tuning :deep(.ant-form-item-label > label)::after {
  content: none;
  margin: 0;
}
/* label 列与控件列的间距：原型 .fitem{gap:12px} 的口径（2026-10-29 实测确认）。不占用
   84px 定宽（若用 padding-right 挤在 84px 内，「Temperature」82px 文本会被压进 8px 内距、
   反而溢出到控件侧），间距放在列外：label 文本右缘 337 → 控件左缘 349，恒等且 12px ≥ 8px。 */
.b3-tuning :deep(.ant-form-item-row) {
  column-gap: 12px;
}
/* -8px 上边距已实测（2026-10-29，vertical 上下文）：与上方 form-item 的视觉间距
   = 24（form-item margin-bottom）− 8 = 16px，与改前完全一致 → 维持不变，不照搬调整 */
/* thinking 三按钮组：label 左置 84px 后 control 列可用宽收窄（1440 下 485 / 1280 下 405），
   radio 组自身 max-content 292px 虽放得下，但更窄容器（侧栏展开 / 更小视口）可能放不下——
   antd .ant-form-item-row 默认 flex-wrap:wrap，一旦放不下整块 control 会折到行首。
   组内允许换行（gap 统一间隙，不靠 margin 补）后，最小占宽降到单按钮 ≈124px，
   任何宽度下都不会再把 control 整块挤下去；按钮文字不得压小（禁缩字号硬塞一行）。 */
.b3-tuning :deep(.ant-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
</style>
