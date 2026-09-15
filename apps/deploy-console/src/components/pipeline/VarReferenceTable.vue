<script setup lang="ts">
import type { PipelineVar } from '@/api'

/**
 * 参数速查表（只读）：写脚本时查键名。
 *
 * 来源层级（后者覆盖前者）：平台内置 → 配置中心 → 流水线变量 → 节点内联。
 * 编辑页「参数」Tab 与节点抽屉「参数」Tab 共用；抽屉里点键名会插入当前节点脚本。
 */
defineProps<{ vars: PipelineVar[] }>()
const emit = defineEmits<{ (e: 'pick', text: string): void }>()

/** 平台注入的内置变量（引擎侧固定注入，不可改） */
const BUILTIN_VARS = [
  { key: 'RELEASE_DIR', desc: '发布根目录（目标机上的代码根）' },
  { key: 'MODULE_KEY', desc: '当前模块 key' },
  { key: 'MODULE_DIR', desc: '模块目录名（由构建/发布脚本指定）' },
  { key: 'MODULE_TYPE', desc: '模块类型（micro-frontend / backend …）' },
  { key: 'BRANCH', desc: '本次分支' },
  { key: 'COMMIT_ID', desc: '本次 commit（=版本号）' },
  { key: 'STAGE', desc: '当前节点 key' },
  { key: 'DEPLOY_ENV', desc: '目标环境（决定投递机器：local=本机，dev/prod=远程）' },
  { key: 'DEPLOY_HOST', desc: '目标机器（由环境取得，脚本里直接用）' },
]

const pick = (k: string) => emit('pick', '${' + k + '}')
</script>

<template>
  <div>
    <div class="muted-text" style="margin-bottom: 8px;">
      注入优先级（后者覆盖前者）：平台内置 → 配置中心 → 流水线变量 → 节点内联
    </div>

    <a-table :data-source="BUILTIN_VARS" :pagination="false" size="small" row-key="key">
      <a-table-column title="内置变量" data-index="key" :width="180">
        <template #default="{ record }">
          <span class="var-chip" @click="pick(record.key)">{{ record.key }}</span>
        </template>
      </a-table-column>
      <a-table-column title="说明" data-index="desc" ellipsis />
    </a-table>

    <div style="margin: 16px 0 8px; font-weight: 600;">本条流水线的变量</div>
    <a-table :data-source="vars" :pagination="false" size="small" row-key="id" table-layout="fixed">
      <a-table-column title="键" data-index="key" :width="180" ellipsis>
        <template #default="{ record }">
          <span class="var-chip" :title="record.key" @click="pick(record.key)">{{ record.key }}</span>
        </template>
      </a-table-column>
      <a-table-column title="当前值" :width="180" ellipsis>
        <template #default="{ record }">
          <span class="mono-text" :title="record.isSecret ? '********' : record.value">
            {{ record.isSecret ? '********' : record.value }}
          </span>
        </template>
      </a-table-column>
      <a-table-column title="说明" data-index="description" ellipsis />
      <template #emptyText>
        <div class="empty-hint">还没有变量 · 去「变量」Tab 添加</div>
      </template>
    </a-table>

    <div class="muted-text" style="margin-top: 10px;">
      点键名可直接插入到当前节点的脚本末尾（<span class="mono-text">${'{'}KEY{'}'}</span> 形式）。
    </div>
  </div>
</template>

<style scoped>
.var-chip {
  font-family: var(--ws-font-mono);
  color: var(--ws-brand-500);
  cursor: pointer;
}
.mono-text { font-family: var(--ws-font-mono); }
.muted-text { font-size: 12px; color: var(--ws-text-tertiary); }
.empty-hint { font-size: 12px; color: var(--ws-text-tertiary); padding: 12px 0; text-align: center; }
</style>
