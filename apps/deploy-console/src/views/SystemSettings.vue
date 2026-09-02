<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { systemSettingsApi } from '@/api'
import { message } from 'ant-design-vue'

const loading = ref(false)
const saving = ref(false)
const webhookUrl = ref('')
const wecomUrl = ref('')

// 审批门禁：需审批的环境
const loadingApproval = ref(false)
const savingApproval = ref(false)
const approvalEnvs = ref('prod')

async function load() {
  loading.value = true
  try {
    const c = await systemSettingsApi.getNotifyChannels()
    webhookUrl.value = c.webhookUrl || ''
    wecomUrl.value = c.wecomUrl || ''
  } catch {
    message.error('加载系统设置失败')
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await systemSettingsApi.updateNotifyChannels({
      webhookUrl: webhookUrl.value.trim() || '',
      wecomUrl: wecomUrl.value.trim() || '',
    })
    message.success('已保存，下一次发布事件将按新配置推送')
    await load()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function loadApproval() {
  loadingApproval.value = true
  try {
    const r = await systemSettingsApi.getApprovalEnvs()
    approvalEnvs.value = r.envs
  } catch {
    /* 静默 */
  } finally {
    loadingApproval.value = false
  }
}

async function saveApproval() {
  savingApproval.value = true
  try {
    await systemSettingsApi.updateApprovalEnvs(approvalEnvs.value)
    message.success('已保存，下一次发布提交将按新规则判定')
    await loadApproval()
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败')
  } finally {
    savingApproval.value = false
  }
}

onMounted(() => {
  load()
  loadApproval()
})
</script>

<template>
  <div>
    <a-card title="通知渠道配置" :loading="loading">
      <template #extra>
        <a-button type="primary" :loading="saving" @click="save">保存</a-button>
      </template>

      <a-form layout="vertical" style="max-width: 640px;">
        <a-form-item label="通用 Webhook URL">
          <a-input
            v-model:value="webhookUrl"
            placeholder="如 https://hook.example/release"
            allow-clear
          />
        </a-form-item>
        <a-form-item label="企业微信机器人 Webhook URL">
          <a-input
            v-model:value="wecomUrl"
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
            allow-clear
          />
        </a-form-item>
      </a-form>

      <a-alert type="info" show-icon style="max-width: 640px;">
        <template #message>
          <div style="line-height: 1.8;">
            <p>
              留空保存即<b>关闭</b>该通道；配置后，发布成功 / 失败 / 自动回滚事件会推送到对应通道。
            </p>
            <p>
              配置存于数据库，页面可随时修改；未配置过的通道会<b>自动回退到服务端环境变量</b>
              （<code>NOTIFY_WEBHOOK_URL</code> / <code>NOTIFY_WECOM_URL</code>），升级迁移期间通知不丢。
            </p>
            <p>
              <b>站内通知默认开启</b>：所有发布事件都会记录在站内（通知中心页），无需额外配置。
            </p>
          </div>
        </template>
      </a-alert>
    </a-card>

    <a-card title="审批门禁（发布前人工确认）" style="margin-top: 16px;" :loading="loadingApproval">
      <template #extra>
        <a-button type="primary" :loading="savingApproval" @click="saveApproval">保存</a-button>
      </template>

      <a-form layout="vertical" style="max-width: 640px;">
        <a-form-item label="需要审批的环境（逗号分隔，默认 prod）">
          <a-input v-model:value="approvalEnvs" placeholder="prod（如也要求 staging：prod, staging）" />
        </a-form-item>
      </a-form>

      <a-alert type="info" show-icon style="max-width: 640px;">
        <template #message>
          提交到列表内环境的发布<b>不会立即执行</b>：先进入「待审批」状态并留审批单（记录提交人/审批人/意见/时间），
          审批通过后自动发布，拒绝则取消并留意见。可在发布流水线页看到待审批项并操作通过/拒绝。
        </template>
      </a-alert>
    </a-card>

    <a-card title="接入提示" style="margin-top: 16px;">
      <p style="color: #888; margin-bottom: 4px;">
        其他系统级设置（度量保留期等）后续按需收敛到本页；当前已有通知渠道与审批门禁两个能力。
      </p>
    </a-card>
  </div>
</template>
