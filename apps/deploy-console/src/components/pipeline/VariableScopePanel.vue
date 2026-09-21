<script setup lang="ts">
/**
 * 变量全景（只读）：这条流水线执行时，动作进程里实际会有哪些变量、各自在哪改。
 *
 * 四级来源与优先级（后者覆盖前者，specs/pipeline-step-task/design.md §3）：
 *   平台内置（引擎注入，不可改） → 配置中心（基础设施/配置中心页） →
 *   流水线变量（编辑页「变量」Tab 维护） → 任务级 env（画布任务抽屉「环境变量」）
 */
import { ref, onMounted } from 'vue'
import { configApi } from '@/api'

const props = defineProps<{ env: string; moduleKey: string }>()

/** 平台内置变量（引擎按提交参数 + 模块登记 + 运行时回填自动生成，不可配置） */
const BUILTIN_VARS = [
  { key: 'DEPLOY_ENV', desc: '目标环境（本次提交选择，如 local / dev；决定投递目标）' },
  { key: 'MODULE_KEY', desc: '当前模块 key' },
  { key: 'MODULE_TYPE', desc: '模块类型（micro-frontend / backend）' },
  { key: 'BRANCH', desc: '本次分支（提交时选择，默认 master）' },
  { key: 'COMMIT_ID', desc: '本次 commit（git 步骤执行后回填，= 版本号）' },
  { key: 'RELEASE_DIR', desc: '目标机上的代码根目录' },
  { key: 'ARTIFACT_DIR', desc: '本模块产物目录（按 模块/环境/版本 推导）' },
  { key: 'DEPLOY_TARGET', desc: '部署目标目录（模块自持 deployRoot 时使用）' },
  { key: 'WS_PLATFORM_SCRIPTS_DIR', desc: '平台脚本目录（write-version 等平台工具所在）' },
  { key: 'GATEWAY_URL', desc: '网关内网地址（探活用）' },
]

interface CfgRow {
  key: string
  value: string
  scope: string
  envId: string
  moduleKey: string
  description?: string
  enabled?: boolean
}

const cfgRows = ref<(CfgRow & { effectiveScope: string })[]>([])
const loadingCfg = ref(false)

onMounted(loadCfg)
async function loadCfg() {
  loadingCfg.value = true
  try {
    // 三级分别拉取，前端合并出「该流水线实际生效集」（module > env > global）
    const [g, e, m] = (await Promise.all([
      configApi.list('global'),
      props.env ? configApi.list(undefined, props.env) : Promise.resolve([]),
      props.moduleKey ? configApi.list(undefined, undefined, props.moduleKey) : Promise.resolve([]),
    ])) as [CfgRow[], CfgRow[], CfgRow[]]
    const map = new Map<string, CfgRow & { effectiveScope: string }>()
    for (const r of [...g, ...e, ...m].filter((x) => x.enabled !== false)) {
      map.set(r.key, { ...r, effectiveScope: r.scope === 'global' ? '全局' : r.scope === 'env' ? `环境 ${r.envId}` : `模块 ${r.moduleKey}` })
    }
    cfgRows.value = [...map.values()]
  } catch {
    cfgRows.value = []
  } finally {
    loadingCfg.value = false
  }
}
</script>

<template>
  <div class="vsp">
    <!-- 优先级说明条 -->
    <div class="prio">
      <b>变量注入优先级</b>（同名键后者覆盖前者）：
      <span class="lv">平台内置</span> →
      <span class="lv">配置中心</span> →
      <span class="lv">流水线变量（本 Tab 维护）</span> →
      <span class="lv">任务级 env（画布任务抽屉「环境变量」）</span>
      。脚本里一律 <code>${'{KEY}'}</code> 引用。
    </div>

    <!-- 平台内置 -->
    <div class="sec">
      <div class="sec-head">
        <b>平台内置变量</b>
        <span class="src">引擎自动注入 · 不可配置</span>
      </div>
      <a-table :data-source="BUILTIN_VARS" :pagination="false" size="small" row-key="key" table-layout="fixed">
        <a-table-column title="键" data-index="key" :width="220">
          <template #default="{ record }"><span class="mono">{{ record.key }}</span></template>
        </a-table-column>
        <a-table-column title="说明" data-index="desc" ellipsis />
      </a-table>
    </div>

    <!-- 配置中心生效项 -->
    <div class="sec">
      <div class="sec-head">
        <b>配置中心生效项</b>
        <span class="src">
          来源：基础设施 → 配置中心（当前环境 <code>{{ env || '—' }}</code> / 模块 <code>{{ moduleKey || '—' }}</code>）
        </span>
      </div>
      <a-spin :spinning="loadingCfg">
        <a-table v-if="cfgRows.length" :data-source="cfgRows" :pagination="false" size="small" row-key="key" table-layout="fixed">
          <a-table-column title="键" data-index="key" :width="220">
            <template #default="{ record }"><span class="mono">{{ record.key }}</span></template>
          </a-table-column>
          <a-table-column title="生效值" data-index="value" :width="220" ellipsis>
            <template #default="{ record }"><span class="mono">{{ record.value }}</span></template>
          </a-table-column>
          <a-table-column title="生效层级" data-index="effectiveScope" :width="110" />
          <a-table-column title="说明" data-index="description" ellipsis>
            <template #default="{ record }">{{ record.description || '—' }}</template>
          </a-table-column>
        </a-table>
        <div v-else class="empty">配置中心没有命中当前环境 / 模块的配置项</div>
      </a-spin>
    </div>
  </div>
</template>

<style scoped>
.prio { font-size: 12px; color: var(--ws-text-secondary); background: var(--ws-bg); border: 1px solid var(--ws-border);
  border-radius: 8px; padding: 10px 12px; line-height: 2; margin-bottom: 14px; }
.prio .lv { background: var(--ws-brand-50); color: var(--ws-brand-500); border-radius: 4px; padding: 1px 6px; font-weight: 600; }
.prio code { font-family: var(--ws-font-mono); background: var(--ws-bg-surface); border: 1px solid var(--ws-border);
  border-radius: 4px; padding: 0 4px; font-size: 11px; }
.sec { margin-bottom: 18px; }
.sec-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.sec-head b { font-size: 13px; color: var(--ws-text-primary); }
.sec-head .src { font-size: 12px; color: var(--ws-text-tertiary); }
.sec-head code { font-family: var(--ws-font-mono); }
.mono { font-family: var(--ws-font-mono); font-size: 12px; }
.empty { font-size: 12px; color: var(--ws-text-tertiary); padding: 12px 0; }
</style>
