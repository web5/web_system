<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { message } from 'ant-design-vue'
import { configApi } from '@/api'

interface ConfigFile {
  name: string
  env: string
  path: string
}

const files = ref<ConfigFile[]>([])
const selectedFile = ref<string | null>(null)
const fileContent = ref('')
const fileEnv = ref('')
const activeTab = ref('all')
const loading = ref(false)
const saving = ref(false)

// 按环境过滤文件
const filteredFiles = ref<ConfigFile[]>([])
function updateFiltered() {
  if (activeTab.value === 'all') {
    filteredFiles.value = files.value
  } else {
    filteredFiles.value = files.value.filter(
      (f) => f.env === activeTab.value.toLowerCase(),
    )
  }
}

// 加载文件列表
async function loadFiles() {
  loading.value = true
  try {
    files.value = await configApi.files()
    updateFiltered()
    // 默认选第一个文件
    if (filteredFiles.value.length > 0 && !selectedFile.value) {
      selectFile(filteredFiles.value[0])
    }
  } catch {
    message.error('加载文件列表失败')
  } finally {
    loading.value = false
  }
}

// 选中文件，加载内容
async function selectFile(file: ConfigFile) {
  selectedFile.value = file.name
  loading.value = true
  try {
    const res = await configApi.file(file.env, file.name)
    fileContent.value = res.content
    fileEnv.value = res.env
  } catch {
    message.error('读取文件失败')
    fileContent.value = ''
  } finally {
    loading.value = false
  }
}

// 保存文件
async function saveFile() {
  if (!selectedFile.value) {
    message.warning('请先选择一个文件')
    return
  }
  saving.value = true
  try {
    await configApi.save(fileEnv.value, selectedFile.value, fileContent.value)
    message.success('保存成功')
  } catch {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

// 切换环境 tab
watch(activeTab, () => {
  updateFiltered()
})

onMounted(() => {
  loadFiles()
})
</script>

<template>
  <div>
    <div class="page-header">
      <h2>配置管理</h2>
      <p>查看和编辑各环境配置文件</p>
    </div>

    <a-card>
      <!-- 环境切换 tab -->
      <a-tabs v-model:activeKey="activeTab" style="margin-bottom: 16px;">
        <a-tab-pane key="all" tab="全部" />
        <a-tab-pane key="dev" tab="DEV" />
        <a-tab-pane key="prod" tab="PROD" />
      </a-tabs>

      <a-row :gutter="16">
        <!-- 左侧文件列表 -->
        <a-col :span="6">
          <div style="margin-bottom: 8px; font-weight: 600; color: rgba(0,0,0,0.65);">
            配置文件
          </div>
          <a-spin :spinning="loading">
            <a-menu
              mode="inline"
              :selected-keys="selectedFile ? [selectedFile] : []"
              style="border-right: 1px solid #f0f0f0; min-height: 400px;"
            >
              <a-menu-item
                v-for="file in filteredFiles"
                :key="file.name"
                @click="selectFile(file)"
              >
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span>{{ file.name }}</span>
                  <a-tag
                    :color="file.env === 'prod' ? 'red' : 'green'"
                    size="small"
                    style="margin-left: 4px; font-size: 11px;"
                  >
                    {{ file.env.toUpperCase() }}
                  </a-tag>
                </div>
              </a-menu-item>
            </a-menu>
          </a-spin>
        </a-col>

        <!-- 右侧编辑器 -->
        <a-col :span="18">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: 600; color: rgba(0,0,0,0.65);">
              {{ selectedFile || '请选择文件' }}
              <a-tag v-if="fileEnv" color="blue" style="margin-left: 8px;">
                {{ fileEnv.toUpperCase() }}
              </a-tag>
            </span>
            <a-button
              type="primary"
              :loading="saving"
              :disabled="!selectedFile"
              @click="saveFile"
            >
              保存
            </a-button>
          </div>
          <a-textarea
            v-model:value="fileContent"
            :rows="22"
            :disabled="!selectedFile"
            placeholder="选择左侧文件查看和编辑内容"
            style="font-family: Menlo, Monaco, 'Courier New', monospace; font-size: 13px;"
          />
        </a-col>
      </a-row>
    </a-card>
  </div>
</template>
