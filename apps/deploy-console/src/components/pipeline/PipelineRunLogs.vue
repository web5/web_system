<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'

const props = withDefaults(
  defineProps<{
    lines: string[]
    /** 外部注入的关键字（例如点击进度流节点时传阶段名，用于快速定位） */
    keyword?: string
    /** 无日志时的占位文案 */
    emptyText?: string
    maxHeight?: number
  }>(),
  {
    keyword: '',
    emptyText: '（暂无日志）',
    maxHeight: 480,
  },
)

const kw = ref(props.keyword)
const follow = ref(true)
const box = ref<HTMLElement | null>(null)

watch(
  () => props.keyword,
  (v) => {
    if (v !== kw.value) kw.value = v
  },
)

/** 过滤后日志（空关键字 = 全部） */
const visibleLines = computed(() => {
  const k = kw.value.trim().toLowerCase()
  if (!k) return props.lines
  return props.lines.filter((l) => l.toLowerCase().includes(k))
})

const logText = computed(() => visibleLines.value.join('\n'))

function scrollToBottom() {
  if (!follow.value || !box.value) return
  box.value.scrollTop = box.value.scrollHeight
}

watch(
  () => logText.value,
  async () => {
    if (follow.value) {
      await nextTick()
      scrollToBottom()
    }
  },
)

function onScroll(e: Event) {
  const el = e.target as HTMLElement
  follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}
</script>

<template>
  <div class="run-logs">
    <div class="log-toolbar">
      <a-input
        :value="kw"
        allow-clear
        placeholder="过滤关键字（如 build / verify / [stage]，留空显示全部）"
        style="max-width: 380px;"
        @change="(e: any) => (kw = e.target.value)"
      >
        <template #prefix>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#999" stroke-width="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M16.5 16.5L21 21" stroke-linecap="round" />
          </svg>
        </template>
      </a-input>
      <span style="color:#999; font-size:12px;">
        共 {{ props.lines.length }} 行
        <template v-if="kw.trim()"> · 命中 {{ visibleLines.length }} 行</template>
      </span>
      <a-checkbox v-model:checked="follow" style="margin-left: auto;">自动滚动</a-checkbox>
    </div>
    <div
      ref="box"
      class="log-body"
      :style="{ maxHeight: props.maxHeight + 'px' }"
      @scroll="onScroll"
    >
      <template v-if="visibleLines.length">
        <template v-for="(l, i) in visibleLines" :key="i">
          <!-- 命令行特殊着色：命中「[stage] $」执行标记 -->
          <div
            v-if="/\[[a-z-]+\]\s*\$/.test(l)"
            class="log-line log-cmd"
          >{{ l }}</div>
          <div
            v-else-if="/error|fail|回滚|警告/i.test(l)"
            class="log-line log-warn"
          >{{ l }}</div>
          <div v-else class="log-line">{{ l }}</div>
        </template>
      </template>
      <div v-else class="log-empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<style scoped>
.run-logs {
  border: 1px solid #1e1e1e;
  border-radius: 6px;
  overflow: hidden;
}
.log-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #1e1e1e;
}
.log-body {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 10px 12px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-line {
  white-space: pre-wrap;
  word-break: break-all;
}
.log-cmd {
  color: #91caff;
}
.log-warn {
  color: #ff7875;
}
.log-empty {
  color: #666;
  padding: 24px 0;
  text-align: center;
}
</style>
