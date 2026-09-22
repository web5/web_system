<template>
  <div class="codeblk">
    <div class="hd">
      <b class="lang">{{ lang || 'code' }}</b>
      <button type="button" class="cp" @click="copyCode">复制</button>
    </div>
    <pre>{{ code }}</pre>
  </div>
</template>

<script setup lang="ts">
/**
 * markdown 围栏代码块（answer-parse 的 code 块）。
 * 可复用：对话 / 翻译 / 合翻等任何需要展示 agent 返回代码处均可引用。
 * 视觉对齐 AiChat 内 blocks（law / tcard 同层语言）：弱底 + 描边圆角，头行语言标签 + 复制，正文等宽横滚。
 */
import { message } from 'ant-design-vue';

const props = defineProps<{ lang?: string; code: string }>();

async function copyCode() {
  if (!props.code) return;
  try {
    await navigator.clipboard.writeText(props.code);
    message.success('已复制');
  } catch {
    message.error('复制失败，请手动选择文本');
  }
}
</script>

<style scoped>
.codeblk {
  margin: 0 0 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-subtle);
  overflow: hidden;
}
.hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ws-border);
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.hd .lang {
  font-weight: 600;
  color: var(--ws-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.hd .cp {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.hd .cp:hover {
  color: var(--ws-brand-700);
}
.codeblk pre {
  margin: 0;
  padding: 12px 16px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px; /* 端内字阶例外：代码块专用（等宽场景惯例） */
  line-height: 1.7;
  color: var(--ws-text-primary);
  white-space: pre;
}
</style>
