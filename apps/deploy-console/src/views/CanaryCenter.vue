<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { canaryApi, deployApi, environmentApi, type CanaryRule } from '@/api'
import dayjs from 'dayjs'

const environments = ref<{ id: string; name: string }[]>([])
const envId = ref('dev')
const modules = ref<{ key: string; name: string; type: string }[]>([])
const moduleKey = ref<string | undefined>(undefined)

const rules = ref<CanaryRule[]>([])
const loading = ref(false)

// ===== 命中预览 =====
const previewing = ref<CanaryRule | null>(null)
const previewUserId = ref('')
const previewResult = ref<boolean | null>(null)

// ===== 放量调整（percent） =====
const scaling = ref<CanaryRule | null>(null)
const scaleValue = ref(10)
const saving = ref(false)

async function loadEnvironments() {
  try {
    environments.value = await environmentApi.list()
    if (!environments.value.find((e) => e.id === envId.value)) {
      envId.value = environments.value[0]?.id || 'dev'
    }
  } catch {
    message.error('加载环境列表失败')
  }
}

async function loadModules() {
  try {
    const all = await deployApi.modules()
    modules.value = all.filter((m) => m.type === 'micro-frontend')
    if (!moduleKey.value && modules.value.length) moduleKey.value = undefined
  } catch {
    message.error('加载模块列表失败')
  }
}

async function loadRules() {
  loading.value = true
  try {
    rules.value = await canaryApi.list(envId.value, moduleKey.value || undefined)
  } catch {
    message.error('加载灰度规则失败')
  } finally {
    loading.value = false
  }
}

function ruleTypeText(r: CanaryRule) {
  const m = r.matchRule
  if (m?.type === 'percent') return `百分比放量 ${m.value ?? 0}%`
  if (m?.type === 'user-list') return `白名单 ${(m.userIds || []).length} 人`
  if (m?.type === 'header') return `请求头 ${m.key}: ${(m.values || []).join(',')}`
  return m?.type || '-'
}

function formatTime(ts?: string) {
  return ts ? dayjs(ts).format('MM-DD HH:mm') : '-'
}

// ===== 预览 =====
function openPreview(r: CanaryRule) {
  previewing.value = r
  previewUserId.value = ''
  previewResult.value = null
}
async function doPreview() {
  if (!previewing.value) return
  if (!previewUserId.value.trim()) {
    message.warning('请输入用户 ID')
    return
  }
  try {
    const res = await canaryApi.preview(previewing.value.id, previewUserId.value.trim())
    previewResult.value = res.hit
  } catch {
    message.error('预览失败')
  }
}

// ===== 放量调整 =====
function openScale(r: CanaryRule) {
  scaling.value = r
  scaleValue.value = Number(r.matchRule?.value ?? 10)
}
async function saveScale() {
  if (!scaling.value) return
  saving.value = true
  try {
    const matchRule = {
      ...scaling.value.matchRule,
      type: 'percent',
      value: scaleValue.value,
    }
    await canaryApi.update(scaling.value.id, { matchRule: matchRule as CanaryRule['matchRule'] })
    message.success(`放量已调整为 ${scaleValue.value}%`)
    scaling.value = null
    await loadRules()
  } catch (e) {
    message.error((e as Error).message || '调整失败')
  } finally {
    saving.value = false
  }
}

// ===== 启停 / 删除 =====
async function toggleEnabled(r: CanaryRule) {
  try {
    await canaryApi.update(r.id, { enabled: !r.enabled })
    message.success(r.enabled ? '已停用灰度' : '已启用灰度')
    await loadRules()
  } catch (e) {
    message.error((e as Error).message || '操作失败')
  }
}

function removeRule(r: CanaryRule) {
  Modal.confirm({
    title: '删除灰度规则',
    content: `删除 ${r.envId}/${r.moduleKey} → ${r.canaryVersion} 的灰度规则？此后流量回到 stable 版本。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await canaryApi.remove(r.id)
        message.success('已删除')
        await loadRules()
      } catch {
        message.error('删除失败')
      }
    },
  })
}

onMounted(async () => {
  await Promise.all([loadEnvironments(), loadModules()])
  await loadRules()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>灰度管理</h2>
      <p>灰度规则由「发布流水线 → 灰度模式」发布时自动创建；在此查看命中规则、调整放量、命中预览与启停</p>
    </div>

    <a-card style="margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
        <!-- 环境互斥单选（≤5 固定）：a-tabs 替代 a-select（design.md §2 #10 / R2 升格） -->
        <a-tabs v-model:activeKey="envId" size="small" @change="loadRules">
          <a-tab-pane v-for="e in environments" :key="e.id" :tab="e.name" />
        </a-tabs>
        <!-- 模块为动态多选项（模块可增删），按规则保留 select（design.md §2 #10：动态/>5 才用 select） -->
        <a-space wrap>
          <a-select
            v-model:value="moduleKey"
            placeholder="全部模块"
            allow-clear
            style="width: 220px;"
            @change="loadRules"
          >
            <a-select-option v-for="m in modules" :key="m.key" :value="m.key">
              {{ m.name }}（{{ m.key }}）
            </a-select-option>
          </a-select>
          <a-button type="primary" @click="loadRules">查询</a-button>
        </a-space>
      </div>
    </a-card>

    <a-card title="灰度规则" :loading="loading">
      <a-table :data-source="rules" row-key="id" size="small" :pagination="{ pageSize: 10 }">
        <a-table-column title="环境" data-index="envId" width="80" />
        <a-table-column title="模块" data-index="moduleKey" />
        <a-table-column title="灰度版本" data-index="canaryVersion" width="130">
          <template #default="{ record }">
            <span style="font-family: monospace;">{{ record.canaryVersion }}</span>
          </template>
        </a-table-column>
        <a-table-column title="规则" key="rule">
          <template #default="{ record }">{{ ruleTypeText(record) }}</template>
        </a-table-column>
        <a-table-column title="状态" data-index="enabled" width="90">
          <template #default="{ record }">
            <a-tag :color="record.enabled ? 'processing' : 'default'">
              {{ record.enabled ? '生效中' : '已停用' }}
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column title="创建时间" key="createdAt" width="120">
          <template #default="{ record }">{{ formatTime(record.createdAt) }}</template>
        </a-table-column>
        <a-table-column title="操作" key="action" width="240">
          <template #default="{ record }">
            <a-space>
              <a-button type="link" size="small" @click="openPreview(record)">命中预览</a-button>
              <a-button
                v-if="record.matchRule?.type === 'percent'"
                type="link"
                size="small"
                @click="openScale(record)"
              >
                调整放量
              </a-button>
              <a-button type="link" size="small" @click="toggleEnabled(record)">
                {{ record.enabled ? '停用' : '启用' }}
              </a-button>
              <a-button type="link" size="small" danger @click="removeRule(record)">删除</a-button>
            </a-space>
          </template>
        </a-table-column>
      </a-table>
      <a-alert
        type="info"
        show-icon
        style="margin-top: 12px;"
        message="命中规则：percent 用「用户ID+规则ID」FNV-1a 稳定哈希，同一用户同一规则结果恒定；全量发布用「流水线 → 转全量」完成。"
      />
    </a-card>

    <!-- 命中预览 -->
    <a-modal
      :open="!!previewing"
      title="灰度命中预览"
      @ok="doPreview"
      @cancel="previewing = null"
    >
      <p v-if="previewing" style="color: #666; margin-bottom: 12px;">
        {{ previewing.envId }} / {{ previewing.moduleKey }} →
        {{ previewing.canaryVersion }}（{{ ruleTypeText(previewing) }}）
      </p>
      <a-input v-model:value="previewUserId" placeholder="输入用户 ID，判断是否命中灰度" />
      <div v-if="previewResult !== null" style="margin-top: 12px;">
        <a-tag :color="previewResult ? 'orange' : 'default'" style="font-size: 14px; padding: 4px 10px;">
          {{ previewResult ? `命中 → 加载灰度版本 ${previewing?.canaryVersion}` : '未命中 → 加载 stable 版本' }}
        </a-tag>
      </div>
    </a-modal>

    <!-- 放量调整 -->
    <a-modal
      :open="!!scaling"
      title="调整放量比例"
      :confirm-loading="saving"
      @ok="saveScale"
      @cancel="scaling = null"
    >
      <p v-if="scaling" style="color: #666; margin-bottom: 12px;">
        {{ scaling.envId }} / {{ scaling.moduleKey }} → {{ scaling.canaryVersion }}
      </p>
      <a-slider v-model:value="scaleValue" :min="1" :max="100" />
      <div style="text-align: center; color: #888;">
        命中 {{ scaleValue }}% 流量
      </div>
    </a-modal>
  </div>
</template>
