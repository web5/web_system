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
/** 新建态（/modules/new）：key 可填、按类型自动带出目录与运行字段 */
const isCreate = computed(() => route.name === 'ModuleCreate')

const loading = ref(false)
const saving = ref(false)
const form = ref<Record<string, any>>({
  key: '',
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

/**
 * 类型 / key 联动（用户 2026-09-15 原型定稿）：
 *  前端 → 目录 apps/<key>、publicPath /<key>/
 *  后台 → 目录 servers/<key>、pm2 进程名 web-<key>
 * 只填空字段，用户改过的不覆盖。
 */
function applyTypeDefaults() {
  const k = (form.value.key || '').trim()
  if (!k) return
  const isBe = form.value.type === 'backend'
  if (!form.value.dir) form.value.dir = isBe ? `servers/${k}` : `apps/${k}`
  if (isBe && !form.value.pm2) form.value.pm2 = `web-${k}`
  if (!isBe && !form.value.publicPath) form.value.publicPath = `/${k}/`
  if (!form.value.buildCmd) {
    form.value.buildCmd = isBe ? 'npm ci && npx tsc -p tsconfig.json' : 'npx vite build'
  }
}
function onTypeChange() {
  // 换类型时把「另一类」的字段清掉，再按新类型带出
  form.value.dir = ''
  if (form.value.type === 'backend') { form.value.publicPath = '' } else { form.value.pm2 = '' }
  form.value.buildCmd = ''
  applyTypeDefaults()
}

async function loadModule() {
  if (isCreate.value) {
    form.value = { key: '', name: '', type: 'backend', dir: '', pm2: '', publicPath: '', buildCmd: '', entry: '', description: '', enabled: true }
    return
  }
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
  const payload = {
    ...form.value,
    name: form.value.name.trim(),
    description: form.value.description?.trim() || undefined,
  }
  saving.value = true
  try {
    if (isCreate.value) {
      const key = String(form.value.key || '').trim()
      if (!key) { message.warning('模块 key 必填'); saving.value = false; return }
      await moduleApi.create({ ...payload, key })
      message.success('模块已创建')
      router.push({ name: 'ModuleDetail', params: { key } })
      return
    }
    await moduleApi.update(moduleKey.value, payload)
    message.success('模块已保存')
    router.push({ name: 'ModuleDetail', params: { key: moduleKey.value } })
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function cancel() {
  if (isCreate.value) { router.back(); return }
  router.push({ name: 'ModuleDetail', params: { key: moduleKey.value } })
}

onMounted(loadModule)
</script>

<template>
  <div style="padding: 16px;">
    <a-card :loading="loading" :title="isCreate ? '新建模块' : `编辑模块 · ${moduleKey}`">
      <a-form layout="vertical" style="max-width: 640px;">
        <a-form-item v-if="isCreate" label="模块 key（slug）· 保存后不可修改" required>
          <a-input
            v-model:value="form.key"
            placeholder="admin"
            style="font-family: monospace;"
            @blur="applyTypeDefaults"
          />
        </a-form-item>
        <a-form-item v-else label="模块 key（不可改）">
          <a-input :value="moduleKey" disabled style="font-family: monospace;" />
        </a-form-item>
        <a-form-item label="名称" required>
          <a-input v-model:value="form.name" placeholder="如：管理后台" />
        </a-form-item>
        <a-form-item label="类型">
          <a-select v-model:value="form.type" @change="onTypeChange">
            <a-select-option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">
              {{ t.label }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="代码目录（相对仓库根；按类型自动带出，可改）">
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
