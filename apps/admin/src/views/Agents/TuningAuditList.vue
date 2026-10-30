<!--
  B3 调参审计展示（页面审计区）
  真源：B3-原型说明.md §3「仅超管 + 审计」——保存成功 Toast + 审计条目（改前→改后字段 diff + 运行时生效值）
  仅管理员及以上可见；后端审计落库不归本组件（展示层）。
-->

<!--
  D4：审计留存 —— 保留近 7 天（时间口径）
  出处：docs/ui/prototypes/agent-def-tuning-质检记录.md:106
  用户 2026-10-29 拍板：条数口径（展示最近 50 条）改为时间口径「保留近 7 天就好」，
  且是「替换」不是「叠加」——7 天内超过 50 条也照常展示，不再设条数上限。
  超期条目由父组件在写入时 prune（AgentDefDetail.vue），本组件只做同期展示过滤。
-->
<template>
  <a-card v-if="visible" class="b3-audit" :bordered="true">
    <template #title>
      调参审计
      <a-tag class="b3-audit-tag">仅管理员及以上可见</a-tag>
    </template>
    <a-empty v-if="!entries.length" description="还没有调参记录（本次会话内保存的调参会显示在这里）" />
    <div v-for="entry in visibleEntries" :key="entry.id" class="b3-audit-item">
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
    <div v-if="hiddenCount > 0" class="b3-audit-cap">
      仅展示近 {{ retentionDays }} 天内的调参记录，已隐藏 {{ hiddenCount }} 条更早记录
    </div>
  </a-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { isWithinTuningAuditRetention, TUNING_AUDIT_RETENTION_MS } from '@/utils/tuning-params';
import type { TuningAuditEntry } from '@/utils/tuning-params';

// D4 留存口径：保留近 7 天（用户 2026-10-29 拍板，替换原「最近 50 条」条数口径）
// 出处：docs/ui/prototypes/agent-def-tuning-质检记录.md:106
const retentionDays = TUNING_AUDIT_RETENTION_MS / (24 * 60 * 60 * 1000);

const props = defineProps<{
  visible: boolean;
  entries: TuningAuditEntry[];
}>();

// 响应式陷阱：computed 里直接调 Date.now() 不会随时间自动重算 ——
// 页面长时间开着且不保存时，屏幕上会一直留着已超期的条目。
// 用 nowTick 每 60s 推一次，把「时间流逝」变成 computed 的依赖。
const nowTick = ref(Date.now());
const timer = setInterval(() => {
  nowTick.value = Date.now();
}, 60_000);
onBeforeUnmount(() => clearInterval(timer));

const visibleEntries = computed(() =>
  props.entries.filter((e) => isWithinTuningAuditRetention(e.ts, nowTick.value)),
);
const hiddenCount = computed(() => props.entries.length - visibleEntries.value.length);
</script>

<style scoped>
.b3-audit {
  margin-top: 16px;
}
.b3-audit-tag {
  margin-left: 8px;
}
.b3-audit-cap {
  padding-top: 10px;
  font-size: 12px;
  color: var(--ws-text-secondary, #525252);
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
