<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { moduleApi, deployApi, hookApi, STAGES } from '@/api'

const route = useRoute()
const router = useRouter()
const moduleKey = computed(() => String(route.params.key || ''))

const moduleInfo = ref<any>(null)
const moduleLoading = ref(false)

const data = ref<{
  environments: any[]
  versionHistory: any[]
} | null>(null)
const dataLoading = ref(false)

const TYPE_LABELS: Record<string, string> = {
  backend: '后端服务',
  frontend: '前端模块',
  'micro-frontend': '微前端模块',
  'mini-app': '小程序',
}

// 后端模块 → 后台 tab，前端模块 → 前端 tab
const showBackendTab = computed(() => moduleInfo.value?.type === 'backend')
const showFrontendTab = computed(() =>
  ['frontend', 'micro-frontend', 'mini-app'].includes(moduleInfo.value?.type),
)
// 默认激活的 tab
const activeTab = ref<string>('')

async function loadModule() {
  moduleLoading.value = true
  try {
    moduleInfo.value = await moduleApi.get(moduleKey.value)
    activeTab.value = showBackendTab.value ? 'backend' : 'frontend'
  } catch {
    message.error('加载模块详情失败')
  } finally {
    moduleLoading.value = false
  }
}

async function loadDeployments() {
  dataLoading.value = true
  try {
    data.value = await deployApi.moduleDeployments(moduleKey.value)
  } catch {
    message.error('加载部署数据失败')
  } finally {
    dataLoading.value = false
  }
}

async function doBuild() {
  try {
    const r = await deployApi.build(moduleKey.value)
    message.success(`构建任务已创建：${r.taskId}`)
  } catch (e: any) {
    message.error(e?.response?.data?.message || '构建失败')
  }
}

async function doRollback(row: any) {
  try {
    await deployApi.rollback(row.env, row.versionTag, true)
    message.success(`已回滚 ${row.env} → ${row.versionTag}`)
    await loadDeployments()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '回滚失败')
  }
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleString('zh-CN')
}

// ===== 发布脚本 Hook =====
const hookStage = ref<string>('build')
const hookScript = ref('')
const hookDirty = ref(false)
const hookSaving = ref(false)
const hookStatus = ref<Record<string, { configured: boolean; updatedBy?: string }>>({})

async function loadHookStatus() {
  try {
    const list = await hookApi.list(moduleKey.value)
    const map: Record<string, { configured: boolean; updatedBy?: string }> = {}
    for (const item of list) map[item.stage] = item
    hookStatus.value = map
  } catch {
    // 非致命
  }
}

async function loadHook() {
  try {
    const h = await hookApi.get(moduleKey.value, hookStage.value)
    hookScript.value = h?.script ?? ''
    hookDirty.value = false
  } catch {
    message.error('加载脚本失败')
  }
}

function selectHookStage(e: { key: string }) {
  hookStage.value = String(e.key)
  void loadHook()
}

async function insertTemplate() {
  try {
    const tpls = await hookApi.templates(moduleInfo.value?.type || 'frontend')
    if (tpls[hookStage.value]) {
      hookScript.value = tpls[hookStage.value]
      hookDirty.value = true
    } else {
      message.warning('该阶段暂无模板')
    }
  } catch {
    message.error('获取模板失败')
  }
}

async function validateHook() {
  try {
    await hookApi.validate(moduleKey.value, hookStage.value, hookScript.value)
    message.success('语法正确')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '语法错误')
  }
}

async function saveHook() {
  if (!hookScript.value.trim()) {
    message.warning('脚本为空，如需清除请用「恢复默认」')
    return
  }
  hookSaving.value = true
  try {
    await hookApi.save(moduleKey.value, hookStage.value, hookScript.value)
    message.success('已保存')
    hookDirty.value = false
    await loadHookStatus()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    hookSaving.value = false
  }
}

async function removeHook() {
  try {
    await hookApi.remove(moduleKey.value, hookStage.value)
    message.success('已恢复流水线内置逻辑')
    hookScript.value = ''
    hookDirty.value = false
    await loadHookStatus()
  } catch {
    message.error('恢复失败')
  }
}

onMounted(async () => {
  await Promise.all([loadModule(), loadDeployments()])
  await loadHookStatus()
  await loadHook()
})
</script>

<template>
  <div>
    <div class="page-header" style="display: flex; align-items: center; gap: 12px;">
      <a-button type="link" @click="router.back()">← 返回</a-button>
      <h2 style="margin: 0;">模块详情</h2>
      <a-tag v-if="moduleInfo" color="blue">{{ moduleInfo.key }}</a-tag>
      <a-tag v-if="moduleInfo?.builtin" color="gold">内置</a-tag>
    </div>

    <!-- 模块元信息 -->
    <a-card v-if="moduleInfo" :loading="moduleLoading" style="margin-bottom: 16px;">
      <a-descriptions :column="3" size="small" bordered>
        <a-descriptions-item label="名称">{{ moduleInfo.name }}</a-descriptions-item>
        <a-descriptions-item label="类型">
          <a-tag>{{ TYPE_LABELS[moduleInfo.type] || moduleInfo.type }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="代码目录">{{ moduleInfo.dir }}</a-descriptions-item>
        <a-descriptions-item v-if="moduleInfo.pm2" label="pm2 进程">{{ moduleInfo.pm2 }}</a-descriptions-item>
        <a-descriptions-item v-if="moduleInfo.publicPath" label="publicPath">{{ moduleInfo.publicPath }}</a-descriptions-item>
        <a-descriptions-item v-if="moduleInfo.buildCmd" label="buildCmd">{{ moduleInfo.buildCmd }}</a-descriptions-item>
        <a-descriptions-item label="启用">
          <a-tag :color="moduleInfo.enabled !== false ? 'green' : 'default'">
            {{ moduleInfo.enabled !== false ? '启用' : '禁用' }}
          </a-tag>
        </a-descriptions-item>
      </a-descriptions>
      <div style="margin-top: 12px;">
        <a-button type="primary" @click="doBuild">构建</a-button>
      </div>
    </a-card>

    <!-- 前端 / 后台 tab -->
    <a-card v-if="moduleInfo" :loading="dataLoading">
      <a-tabs v-model:active-key="activeTab">
        <!-- 后台 tab -->
        <a-tab-pane v-if="showBackendTab" key="backend" tab="后台">
          <h3 style="margin-bottom: 12px; font-size: 15px;">当前部署（环境 × 版本）</h3>
          <a-table
            :columns="[
              { title: '环境', dataIndex: 'envId', key: 'envId', width: 120 },
              { title: '当前版本', dataIndex: 'currentVersion', key: 'currentVersion' },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '部署时间', dataIndex: 'deployedAt', key: 'deployedAt', width: 180 },
              { title: '部署人', dataIndex: 'deployedBy', key: 'deployedBy', width: 120 },
            ]"
            :data-source="data?.environments || []"
            :pagination="false"
            row-key="envId"
            size="small"
            :locale="{ emptyText: '该模块在所有环境均未部署' }"
          />

          <h3 style="margin: 24px 0 12px; font-size: 15px;">版本历史（可回滚）</h3>
          <a-table
            :columns="[
              { title: '版本', dataIndex: 'versionTag', key: 'versionTag', width: 200 },
              { title: '环境', dataIndex: 'env', key: 'env', width: 100 },
              { title: 'git commit', dataIndex: 'gitCommit', key: 'gitCommit', width: 140 },
              { title: '发布时间', dataIndex: 'releasedAt', key: 'releasedAt', width: 180 },
              { title: '发布人', dataIndex: 'releasedBy', key: 'releasedBy', width: 120 },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '操作', key: 'action', width: 100 },
            ]"
            :data-source="data?.versionHistory || []"
            :pagination="{ pageSize: 10 }"
            row-key="id"
            size="small"
            :locale="{ emptyText: '暂无版本历史' }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'releasedAt'">{{ fmtDate(record.releasedAt) }}</template>
              <template v-else-if="column.key === 'action'">
                <a-popconfirm
                  :title="`回滚 ${record.env} 到 ${record.versionTag}？`"
                  ok-text="回滚"
                  cancel-text="取消"
                  @confirm="doRollback(record)"
                >
                  <a-button type="link" size="small">回滚到此版本</a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- 前端 tab -->
        <a-tab-pane v-if="showFrontendTab" key="frontend" tab="前端">
          <h3 style="margin-bottom: 12px; font-size: 15px;">当前部署（环境 × 版本）</h3>
          <a-table
            :columns="[
              { title: '环境', dataIndex: 'envId', key: 'envId', width: 120 },
              { title: '当前版本', dataIndex: 'currentVersion', key: 'currentVersion' },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '部署时间', dataIndex: 'deployedAt', key: 'deployedAt', width: 180 },
              { title: '部署人', dataIndex: 'deployedBy', key: 'deployedBy', width: 120 },
            ]"
            :data-source="data?.environments || []"
            :pagination="false"
            row-key="envId"
            size="small"
            :locale="{ emptyText: '该模块在所有环境均未部署' }"
          />

          <h3 style="margin: 24px 0 12px; font-size: 15px;">版本历史（可回滚）</h3>
          <a-table
            :columns="[
              { title: '版本', dataIndex: 'versionTag', key: 'versionTag', width: 200 },
              { title: '环境', dataIndex: 'env', key: 'env', width: 100 },
              { title: 'git commit', dataIndex: 'gitCommit', key: 'gitCommit', width: 140 },
              { title: '发布时间', dataIndex: 'releasedAt', key: 'releasedAt', width: 180 },
              { title: '发布人', dataIndex: 'releasedBy', key: 'releasedBy', width: 120 },
              { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
              { title: '操作', key: 'action', width: 100 },
            ]"
            :data-source="data?.versionHistory || []"
            :pagination="{ pageSize: 10 }"
            row-key="id"
            size="small"
            :locale="{ emptyText: '暂无版本历史' }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'releasedAt'">{{ fmtDate(record.releasedAt) }}</template>
              <template v-else-if="column.key === 'action'">
                <a-popconfirm
                  :title="`回滚 ${record.env} 到 ${record.versionTag}？`"
                  ok-text="回滚"
                  cancel-text="取消"
                  @confirm="doRollback(record)"
                >
                  <a-button type="link" size="small">回滚到此版本</a-button>
                </a-popconfirm>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- 两个 tab 都不显示时的兜底 -->
        <a-empty v-if="!showBackendTab && !showFrontendTab" description="该模块类型暂不支持版本管理" />

        <!-- 发布脚本 Hook tab（各阶段可自定义 shell，DB 为真相源） -->
        <a-tab-pane key="hooks" tab="发布脚本">
          <div style="display: flex; gap: 16px;">
            <div style="width: 170px; flex-shrink: 0;">
              <a-menu
                :selected-keys="[hookStage]"
                mode="inline"
                style="border-right: none;"
                @click="selectHookStage"
              >
                <a-menu-item v-for="s in STAGES" :key="s">
                  <span style="display: inline-flex; align-items: center; gap: 6px;">
                    {{ s }}
                    <a-tag
                      v-if="hookStatus[s]?.configured"
                      color="green"
                      style="font-size: 11px; line-height: 14px; height: auto; padding: 0 4px;"
                    >自定义</a-tag>
                  </span>
                </a-menu-item>
              </a-menu>
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <span>
                  <b>{{ hookStage }}</b> 阶段脚本
                  <a-tag v-if="hookStatus[hookStage]?.configured" color="blue" style="margin-left: 6px;">
                    最后编辑：{{ hookStatus[hookStage]?.updatedBy || '—' }}
                  </a-tag>
                  <a-tag v-if="hookDirty" color="orange" style="margin-left: 6px;">未保存</a-tag>
                </span>
                <a-space>
                  <a-button size="small" @click="insertTemplate">插入模板</a-button>
                  <a-button size="small" @click="validateHook">语法校验</a-button>
                  <a-button size="small" @click="loadHook">刷新</a-button>
                  <a-popconfirm title="恢复该阶段为流水线内置逻辑？" ok-text="恢复" cancel-text="取消" @confirm="removeHook">
                    <a-button size="small" danger>恢复默认</a-button>
                  </a-popconfirm>
                  <a-button size="small" type="primary" :loading="hookSaving" @click="saveHook">保存</a-button>
                </a-space>
              </div>
              <a-textarea
                v-model:value="hookScript"
                :rows="20"
                style="font-family: monospace; font-size: 12px; line-height: 1.6;"
                placeholder="# 留空 = 使用流水线内置逻辑
# 点击「插入模板」可快速生成对应模块类型的默认脚本"
              />
              <div style="margin-top: 8px; color: #888; font-size: 12px; line-height: 1.8;">
                可用环境变量：<code>DEPLOY_ENV / MODULE_KEY / BRANCH / COMMIT_ID / RELEASE_DIR / STAGE / MODULE_TYPE / MODULE_DIR / PM2_NAME</code><br />
                脚本以 <code>bash</code> 非交互执行，输出流式进入流水线日志；退出码非 0 视为该阶段失败、中断发布。
              </div>
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>