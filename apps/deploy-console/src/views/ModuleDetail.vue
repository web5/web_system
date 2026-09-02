<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { moduleApi, deployApi, stageCommandApi, CONFIGURABLE_STAGES } from '@/api'

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

// ===== 阶段命令（发布流水线唯一执行真相源）=====
const cmdStage = ref<string>('build')
const cmdText = ref('')
const cmdDirty = ref(false)
const cmdSaving = ref(false)
const cmdStatus = ref<Record<string, { configured: boolean; updatedBy?: string }>>({})

async function loadCmdStatus() {
  try {
    const list = await stageCommandApi.list(moduleKey.value)
    const map: Record<string, { configured: boolean; updatedBy?: string }> = {}
    for (const item of list) map[item.stage] = item
    cmdStatus.value = map
  } catch {
    // 非致命
  }
}

async function loadCmd() {
  try {
    const c = await stageCommandApi.get(moduleKey.value, cmdStage.value)
    cmdText.value = c?.command ?? ''
    cmdDirty.value = false
  } catch {
    message.error('加载阶段命令失败')
  }
}

function selectCmdStage(e: { key: string }) {
  cmdStage.value = String(e.key)
  void loadCmd()
}

/** 插入默认模板：后端按模块类型返回默认构建命令 */
async function insertTemplate() {
  try {
    const tpl = await stageCommandApi.template(moduleInfo.value?.type || 'frontend')
    if (tpl) {
      cmdText.value = tpl
      cmdDirty.value = true
    } else {
      message.warning('该模块类型暂无默认模板')
    }
  } catch {
    message.error('获取模板失败')
  }
}

async function validateCmd() {
  try {
    await stageCommandApi.validate(moduleKey.value, cmdStage.value, cmdText.value)
    message.success('语法正确')
  } catch (e: any) {
    message.error(e?.response?.data?.message || '语法错误')
  }
}

async function saveCmd() {
  if (!cmdText.value.trim()) {
    message.warning('命令为空，如需清除请用「恢复默认」')
    return
  }
  cmdSaving.value = true
  try {
    await stageCommandApi.save(moduleKey.value, cmdStage.value, cmdText.value)
    message.success('已保存')
    cmdDirty.value = false
    await loadCmdStatus()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    cmdSaving.value = false
  }
}

async function removeCmd() {
  try {
    await stageCommandApi.remove(moduleKey.value, cmdStage.value)
    message.success('已恢复流水线内置逻辑')
    cmdText.value = ''
    cmdDirty.value = false
    await loadCmdStatus()
  } catch {
    message.error('恢复失败')
  }
}

onMounted(async () => {
  await Promise.all([loadModule(), loadDeployments()])
  await loadCmdStatus()
  await loadCmd()
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

        <!-- 阶段命令 tab（每模块每阶段一条 shell，DB 为唯一真相源） -->
        <a-tab-pane key="stage-commands" tab="阶段命令">
          <div style="display: flex; gap: 16px;">
            <div style="width: 170px; flex-shrink: 0;">
              <a-menu
                :selected-keys="[cmdStage]"
                mode="inline"
                style="border-right: none;"
                @click="selectCmdStage"
              >
                <a-menu-item v-for="s in CONFIGURABLE_STAGES" :key="s">
                  <span style="display: inline-flex; align-items: center; gap: 6px;">
                    {{ s }}
                    <a-tag
                      v-if="s === 'build'"
                      color="red"
                      style="font-size: 11px; line-height: 14px; height: auto; padding: 0 4px;"
                    >必填</a-tag>
                    <a-tag
                      v-else-if="cmdStatus[s]?.configured"
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
                  <b>{{ cmdStage }}</b> 阶段命令
                  <a-tag v-if="cmdStatus[cmdStage]?.configured" color="blue" style="margin-left: 6px;">
                    最后编辑：{{ cmdStatus[cmdStage]?.updatedBy || '—' }}
                  </a-tag>
                  <a-tag v-if="cmdDirty" color="orange" style="margin-left: 6px;">未保存</a-tag>
                </span>
                <a-space>
                  <a-button size="small" @click="insertTemplate">插入模板</a-button>
                  <a-button size="small" @click="validateCmd">语法校验</a-button>
                  <a-button size="small" @click="loadCmd">刷新</a-button>
                  <a-popconfirm title="恢复该阶段为流水线内置逻辑？" ok-text="恢复" cancel-text="取消" @confirm="removeCmd">
                    <a-button size="small" danger>恢复默认</a-button>
                  </a-popconfirm>
                  <a-button size="small" type="primary" :loading="cmdSaving" @click="saveCmd">保存</a-button>
                </a-space>
              </div>
              <a-textarea
                v-model:value="cmdText"
                :rows="20"
                style="font-family: monospace; font-size: 12px; line-height: 1.6;"
                :placeholder="
                  cmdStage === 'build'
                    ? '# build 阶段必填：未配置将直接终止发布（不回退任何内置硬编码）\n# 点击「插入模板」可生成该模块类型的默认构建命令'
                    : '# 留空 = 使用流水线内置逻辑\n# 填写后该阶段改由本命令执行'
                "
              />
              <div style="margin-top: 8px; color: #888; font-size: 12px; line-height: 1.8;">
                可用环境变量：<code>DEPLOY_ENV / MODULE_KEY / BRANCH / COMMIT_ID / RELEASE_DIR / STAGE / MODULE_TYPE / MODULE_DIR / PM2_NAME</code><br />
                命令以 <code>bash -c</code> 执行，输出流式进入流水线日志；退出码非 0 视为该阶段失败、中断发布。<br />
                <code>version</code> / <code>pointer</code> 为发布语义真相源，固定由流水线执行，不在此配置。
              </div>
            </div>
          </div>
        </a-tab-pane>

      </a-tabs>
    </a-card>

  </div>
</template>