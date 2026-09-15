<script setup lang="ts">
/**
 * 编辑模块（定义态）。
 *
 * 与「模块详情」同源同数据，区别只在可编辑 + 保存：
 *  - 前端/微前端/小程序：名称 / 类型 / 目录 / 构建命令 / publicPath
 *  - 后端服务：额外维护 pm2 名与入口文件
 * key 是产物命名空间的一部分，创建后不可改。
 */
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { moduleApi } from '@/api'

const route = useRoute()
const router = useRouter()
const moduleKey = computed(() => String(route.params.key || ''))

const loading = ref(false)
const saving = ref(false)
const form = ref<Record<string, any>>({
  name: '',
  type: 'backend',
  dir: '',
  pm2: '',
  publicPath: '',
  buildCmd: '',
  entry: '',
  description: '',
  enabled: true,
})

const TYPE_OPTIONS = [
  { value: 'backend', label: '后端服务' },
  { value: 'frontend', label: '前端模块' },
  { value: 'micro-frontend', label: '微前端模块' },
  { value: 'mini-app', label: '小程序' },
]
const isBackend = computed(() => form.value.type === 'backend')

async function loadModule() {
  if (!moduleKey.value) return
  loading.value = true
  try {
    const m = await moduleApi.get(moduleKey.value)
    form.value = {
      name: m?.name || '',
      type: m?.type || 'backend',
      dir: m?.dir || '',
      pm2: m?.pm2 || '',
      publicPath: m?.publicPath || '',
      buildCmd: m?.buildCmd || '',
      entry: m?.entry || '',
      description: m?.description || '',
      enabled: m?.enabled !== false,
    }
  } catch {
    message.error('加载模块失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!form.value.name.trim()) {
    message.warning('模块名称必填')
    return
  }
  saving.value = true
  try {
    await moduleApi.update(moduleKey.value, {
      ...form.value,
      name: form.value.name.trim(),
      description: form.value.description?.trim() || undefined,
    })
    message.success('模块已保存')
    router.push({ name: 'ModuleDetail', params: { key: moduleKey.value } })
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function cancel() {
  router.push({ name: 'ModuleDetail', params: { key: moduleKey.value } })
}

onMounted(loadModule)
</script>

<template>
  <div style="padding: 16px;">
    <a-card :loading="loading" :title="`编辑模块 · ${moduleKey}`">
      <a-form layout="vertical" style="max-width: 640px;">
        <a-form-item label="模块 key（不可改）">
          <a-input :value="moduleKey" disabled style="font-family: monospace;" />
        </a-form-item>
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="如：管理后台" />
        </a-form-item>
        <a-form-item label="类型">
          <a-select v-model:value="form.type">
            <a-select-option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">
              {{ t.label }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="代码目录">
          <a-input v-model:value="form.dir" placeholder="apps/admin" style="font-family: monospace;" />
        </a-form-item>
        <a-form-item label="构建命令">
          <a-input v-model:value="form.buildCmd" placeholder="npm run build" style="font-family: monospace;" />
        </a-form-item>
        <template v-if="isBackend">
          <a-form-item label="pm2 进程名">
            <a-input v-model:value="form.pm2" placeholder="web-gateway" style="font-family: monospace;" />
          </a-form-item>
          <a-form-item label="入口文件">
            <a-input v-model:value="form.entry" placeholder="dist/main.js" style="font-family: monospace;" />
          </a-form-item>
        </template>
        <a-form-item v-else label="publicPath（静态资源挂载路径）">
          <a-input v-model:value="form.publicPath" placeholder="admin" style="font-family: monospace;" />
        </a-form-item>
        <a-form-item label="说明">
          <a-textarea v-model:value="form.description" :rows="3" placeholder="模块用途说明" />
        </a-form-item>
        <a-form-item label="启用">
          <a-switch v-model:checked="form.enabled" />
        </a-form-item>
      </a-form>

      <div style="display: flex; gap: 8px;">
        <a-button type="primary" :loading="saving" @click="save">保存</a-button>
        <a-button @click="cancel">取消</a-button>
      </div>
    </a-card>
  </div>
</template>
