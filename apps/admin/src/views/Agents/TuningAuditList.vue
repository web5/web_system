<!--
  B3 调参审计展示（页面审计区）
  真源：B3-原型说明.md §3「仅超管 + 审计」——保存成功 Toast + 审计条目（改前→改后字段 diff + 运行时生效值）
  仅超级管理员可见；后端审计落库不归本组件（展示层）。
-->
<template>
  <a-card v-if="visible" class="b3-audit" :bordered="true">
    <template #title>
      调参审计
      <a-tag class="b3-audit-tag">仅超级管理员可见</a-tag>
    </template>
    <a-empty v-if="!entries.length" description="还没有调参记录（本次会话内保存的调参会显示在这里）" />
    <div v-for="entry in entries" :key="entry.id" class="b3-audit-item">
      <div class="b3-audit-head">
        <span class="b3-audit-time">{{ entry.time }}</span>
        <b>{{ entry.agentName }}</b>
        <span class="b3-audit-op">{{ entry.operator }}</span>
      </div>
      <div v-for="d in entry.diffs" :key="d.field" class="b3-diff-row">
        <span class="b3-diff-field">{{ d.field }}</span>
        <span class="b3-diff-before">{{ d.before }}</span>
        <span class="b3-diff-arrow">→</span>
        <span class="b3-diff-after">{{ d.after }}</span>
      </div>
      <div class="b3-runtime">{{ entry.runtimeNote }}</div>
    </div>
  </a-card>
</template>

<script setup lang="ts">
import type { TuningAuditEntry } from '@/utils/tuning-params';

defineProps<{
  visible: boolean;
  entries: TuningAuditEntry[];
}>();
</script>

<style scoped>
.b3-audit {
  margin-top: 16px;
}
.b3-audit-tag {
  margin-left: 8px;
}
.b3-audit-item {
  padding: 12px 0;
  border-bottom: 1px solid var(--ws-border-subtle, #ebebeb);
}
.b3-audit-item:last-child {
  border-bottom: none;
}
.b3-audit-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}
.b3-audit-time {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  color: var(--ws-text-secondary, #525252);
}
.b3-audit-op {
  color: var(--ws-text-secondary, #525252);
  font-size: 12px;
}
.b3-diff-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 22px;
}
.b3-diff-field {
  width: 90px;
  flex-shrink: 0;
  color: var(--ws-text-secondary, #525252);
}
.b3-diff-before {
  text-decoration: line-through;
  color: var(--ws-text-secondary, #525252);
}
.b3-diff-arrow {
  color: var(--ws-text-secondary, #525252);
}
.b3-diff-after {
  font-weight: 600;
  color: var(--ws-text-primary, #1a1a1a);
}
.b3-runtime {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ws-text-secondary, #525252);
}
</style>
