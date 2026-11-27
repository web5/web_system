<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { aguiBus } from 'agui-bus';
import type { WidgetProps } from '@/lib/widget-protocol';
import type { WidgetMountContext } from '@/microfrontend/widget-contract';

const props = defineProps<{ data: WidgetProps; ctx: WidgetMountContext }>();

// —— dataSource（D3-B 拍板）：fence props 给初始 placeholder，接口给占位符与提交回显 ——
const dataSource = computed(() => String(props.data.dataSource ?? '').replace(/\/+$/, ''));

const remotePlaceholder = ref('');
const placeholder = computed(() => {
  const fromProps = props.data.placeholder;
  if (typeof fromProps === 'string' && fromProps.trim()) return fromProps;
  if (remotePlaceholder.value) return remotePlaceholder.value;
  return '输入点什么…';
});

let disposed = false; // 竞态护栏：fetch 回来时组件可能已卸载

/** 挂载后拉取接口占位符（失败静默回退 props，表单主体不受影响）。 */
async function refresh(): Promise<void> {
  if (!dataSource.value) return;
  try {
    const res = await fetch(dataSource.value, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { placeholder?: unknown };
    if (disposed) return;
    if (typeof json.placeholder === 'string') remotePlaceholder.value = json.placeholder;
  } catch {
    /* 占位符拉取失败：静默回退 props，不提示不崩 */
  }
}

// 🔴 输入框状态：验证「后续 token 继续流式吐出不清空已挂载子应用的输入」
const draft = ref('');
const submitted = ref('');
const charCount = ref(0);
const submitting = ref(false);
const submitError = ref('');
const echo = ref('');
let off: (() => void) | null = null;

async function submit(): Promise<void> {
  const value = draft.value.trim();
  if (!value) return;
  submitted.value = value;
  aguiBus.emit('widget_action', {
    type: 'widget_action',
    app: 'form',
    value,
    slotId: props.ctx.slotId,
    label: '表单组件',
  });
  // D3-B：Shadow DOM 直连 demo-backend 提交回显（不走基座转发）
  if (!dataSource.value || submitting.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const res = await fetch(dataSource.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; echo?: { value?: string }; error?: string }
      | null;
    if (res.ok && json?.ok) {
      echo.value = json.echo?.value ?? value;
    } else {
      submitError.value = `提交失败：${json?.error ?? `HTTP ${res.status}`}`;
    }
  } catch (e) {
    submitError.value = `提交请求失败：${(e as Error).message}`;
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  off = aguiBus.on('widget_action', (e) => {
    charCount.value = e.value.length;
  });
  props.ctx.trace('bus-bind', 'aguiBus.on("widget_action") 已注册（基座单例）');
  void refresh();
});
onUnmounted(() => {
  disposed = true;
  off?.();
});
</script>

<template>
  <div class="w-head">
    <span class="w-title">交互表单 · 输入 + 提交</span>
    <span class="w-tag">System.register · form</span>
  </div>
  <p class="w-hint">先输入几个字，等后面的 markdown 继续吐完，回头看输入框内容还在不在。</p>
  <div class="form-row">
    <input v-model="draft" class="form-input" type="text" :placeholder="placeholder" @keyup.enter="submit" />
    <button class="form-btn" type="button" :disabled="!draft.trim() || submitting" @click="submit">
      {{ submitting ? '提交中…' : '提交' }}
    </button>
  </div>
  <div class="form-feedback">
    <span v-if="submitted">✅ 已提交：{{ submitted }}（输入状态仍保留在上方输入框）</span>
    <span v-else>输入框当前 {{ draft.length }} 个字符 · bus 最近回写长度 {{ charCount }}</span>
  </div>
  <div class="w-ds">
    <span v-if="submitError" class="w-ds-error">⚠ {{ submitError }}</span>
    <span v-else-if="echo">服务端回显：{{ echo }}</span>
    <span v-else-if="submitting">提交中…</span>
    <span v-else-if="dataSource">实时数据源 · 提交后服务端原样回显</span>
  </div>
</template>
