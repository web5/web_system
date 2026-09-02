<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { toolApi, type ToolItem } from '@/api'

const CATEGORY_LABELS: Record<string, string> = {
  code: '代码获取',
  build: '构建',
  deploy: '投递部署',
  probe: '探活验证',
  rollback: '回滚',
  cleanup: '清理',
  semantic: '发布语义',
  generic: '通用',
}

const CATEGORIES = [
  'code',
  'build',
  'deploy',
  'probe',
  'rollback',
  'cleanup',
  'semantic',
  'generic',
]

const tools = ref<ToolItem[]>([])
const loading = ref(false)
const filterCategory = ref<string | undefined>(undefined)
const filterKind = ref<string | undefined>(undefined)

async function load() {
  loading.value = true
  try {
    tools.value = await toolApi.list({
      ...(filterCategory.value ? { category: filterCategory.value } : {}),
      ...(filterKind.value ? { kind: filterKind.value } : {}),
    })
  } catch {
    message.error('加载工具目录失败')
  } finally {
    loading.value = false
  }
}

async function toggleAvailable(t: ToolItem) {
  try {
    await toolApi.update(t.code, { available: !t.available })
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '操作失败')
  }
}

function removeTool(t: ToolItem) {
  Modal.confirm({
    title: '删除工具',
    content: `删除「${t.name}」？内置工具不可删除。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await toolApi.remove(t.code)
        message.success('已删除')
        await load()
      } catch (e: any) {
        message.error(e?.response?.data?.message || '删除失败')
      }
    },
  })
}

// ===== 新增 / 编辑工具（含可复用命令正文，bash -n 由后端校验） =====
const addOpen = ref(false)
const addSaving = ref(false)
const editingTool = ref<ToolItem | null>(null)
const addForm = ref({
  name: '',
  category: 'generic' as string,
  description: '',
  example: '',
  command: '',
})

function openAdd() {
  editingTool.value = null
  addForm.value = { name: '', category: 'generic', description: '', example: '', command: '' }
  addOpen.value = true
}
function openEdit(t: ToolItem) {
  editingTool.value = t
  addForm.value = {
    name: t.name,
    category: t.category,
    description: t.description || '',
    example: t.example || '',
    command: t.command || '',
  }
  addOpen.value = true
}
async function saveTool() {
  const m = addForm.value
  if (!editingTool.value && !m.name.trim()) {
    message.warning('工具名必填')
    return
  }
  addSaving.value = true
  try {
    const payload = {
      category: m.category,
      description: m.description.trim() || undefined,
      example: m.example.trim() || undefined,
      command: m.command.trim() || undefined,
    }
    if (editingTool.value) {
      await toolApi.update(editingTool.value.code, payload)
      message.success('工具已更新')
    } else {
      await toolApi.create({ name: m.name.trim(), ...payload })
      message.success('已新增（code 由名称自动生成）')
    }
    addOpen.value = false
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    addSaving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="page-header">
      <h2>工具目录</h2>
      <p>平台可用能力单元：service = 内置执行器（探活/回滚/写版本/切指针等，与流水线步骤对应）；shell = 外部 CLI</p>
    </div>

    <a-card style="margin-bottom: 16px;">
      <a-space wrap>
        <span style="color: #888;">分类：</span>
        <a-select
          v-model:value="filterCategory"
          placeholder="全部分类"
          allow-clear
          style="width: 160px;"
          @change="load"
        >
          <a-select-option v-for="c in CATEGORIES" :key="c" :value="c">
            {{ CATEGORY_LABELS[c] || c }}
          </a-select-option>
        </a-select>
        <a-radio-group v-model:value="filterKind" @change="load">
          <a-radio-button value="">全部</a-radio-button>
          <a-radio-button value="service">内置执行器</a-radio-button>
          <a-radio-button value="shell">Shell CLI</a-radio-button>
        </a-radio-group>
        <a-button type="primary" @click="openAdd">新增 Shell 工具</a-button>
      </a-space>
    </a-card>

    <a-card title="工具清单" :loading="loading">
      <a-table :data-source="tools" row-key="code" size="small" :pagination="{ pageSize: 15 }">
        <a-table-column title="工具" data-index="code" width="140">
          <template #default="{ record }">
            <span style="font-family: monospace;">{{ record.code }}</span>
          </template>
        </a-table-column>
        <a-table-column title="名称" data-index="name" width="140" />
        <a-table-column title="类型" data-index="kind" width="110">
          <template #default="{ record }">
            <a-tag :color="record.kind === 'service' ? 'blue' : 'green'">
              {{ record.kind === 'service' ? '内置执行器' : 'Shell CLI' }}
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column title="分类" data-index="category" width="100">
          <template #default="{ record }">
            {{ CATEGORY_LABELS[record.category] || record.category }}
          </template>
        </a-table-column>
        <a-table-column title="说明" data-index="description" ellipsis />
        <a-table-column title="命令/示例" key="cmd" ellipsis>
          <template #default="{ record }">
            <code v-if="record.command" style="font-size: 12px;">{{ record.command }}</code>
            <span v-else-if="record.example" style="font-size: 12px; color: #888;">{{ record.example }}</span>
            <span v-else style="color: #bbb;">—</span>
          </template>
        </a-table-column>
        <a-table-column title="可用" data-index="available" width="80">
          <template #default="{ record }">
            <a-switch :checked="record.available" size="small" @change="toggleAvailable(record)" />
          </template>
        </a-table-column>
        <a-table-column title="操作" key="action" width="140">
          <template #default="{ record }">
            <a-space>
              <a-button type="link" size="small" @click="openEdit(record)">编辑</a-button>
              <a-button
                v-if="!record.builtin"
                type="link"
                size="small"
                danger
                @click="removeTool(record)"
              >
                删除
              </a-button>
              <span v-if="record.builtin && record.kind === 'service'" style="color: #bbb; font-size: 12px;">
                内置
              </span>
            </a-space>
          </template>
        </a-table-column>
      </a-table>
    </a-card>

    <a-modal
      v-model:open="addOpen"
      :title="editingTool ? '编辑工具：' + editingTool.code : '新增 Shell 工具'"
      :confirm-loading="addSaving"
      @ok="saveTool"
    >
      <a-form layout="vertical">
        <a-form-item label="工具名（code 由创建时名称自动生成，如 My Tool → my-tool）">
          <a-input
            v-model:value="addForm.name"
            :disabled="!!editingTool"
            placeholder="如：docker / jq"
          />
        </a-form-item>
        <a-form-item label="分类">
          <a-select v-model:value="addForm.category" style="width: 200px;">
            <a-select-option v-for="c in CATEGORIES" :key="c" :value="c">
              {{ CATEGORY_LABELS[c] || c }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="可复用命令正文（bash，保存时语法校验；可被阶段命令编辑器一键插入）">
          <a-textarea
            v-model:value="addForm.command"
            :rows="4"
            style="font-family: monospace; font-size: 12px;"
            placeholder="如：
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT:-6200}/
支持流水线注入变量：DEPLOY_ENV / MODULE_KEY / MODULE_DIR / MODULE_TYPE / RELEASE_DIR / BRANCH / COMMIT_ID / STAGE / PM2_NAME"
          />
        </a-form-item>
        <a-form-item label="说明">
          <a-input v-model:value="addForm.description" />
        </a-form-item>
        <a-form-item label="示例（无命令时列表展示）">
          <a-input v-model:value="addForm.example" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>
