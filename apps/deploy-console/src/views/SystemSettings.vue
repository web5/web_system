<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { systemSettingsApi } from '@/api'
import { message } from 'ant-design-vue'
// 存储配置（A6）：上传根目录的查看与修改（属 system-service，见组件内注释）
import StorageConfigCard from '@/components/StorageConfigCard.vue'
// 外观（2026-09-23）：圆角风格用户偏好三档（口径 specs/radius-style-dual §4.4）
import { radiusStyle, setRadiusStyle, RADIUS_OPTIONS } from '@/composables/useAppearance'

/** 外观：圆角风格切换（与 App.vue 共用同一偏好单例）；说明文案与原型一致，故为静态三档全列 */
function onRadiusChange(e: any) {
  setRadiusStyle(e.target.value)
}

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
        <!-- 非 primary：本页的主操作是「存储配置」的保存（一屏一个 primary） -->
        <a-button :loading="saving" @click="save">保存</a-button>
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
        <a-button :loading="savingApproval" @click="saveApproval">保存</a-button>
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

    <!-- 外观（2026-09-23）：圆角风格用户偏好三档（口径 specs/radius-style-dual §4.4） -->
    <a-card title="外观" style="margin-top: 16px;">
      <div class="appearance-row">
        <span class="appearance-label">圆角风格</span>
        <a-radio-group :value="radiusStyle" button-style="solid" @change="onRadiusChange">
          <a-radio-button v-for="o in RADIUS_OPTIONS" :key="o.value" :value="o.value">
            {{ o.label }}
          </a-radio-button>
        </a-radio-group>
      </div>
      <p class="appearance-hint">
        柔和：圆角更大更圆润（默认）；清爽：更小更利落；直角：无圆角。切换后全站立即生效（含 antd 组件）。
      </p>
      <div class="appearance-row" style="margin-top: 12px;">
        <span class="appearance-label">深色模式</span>
      </div>
      <p class="appearance-hint">外壳固定深色（sider / header 反白面板），不随主题变化；本页仅提供圆角偏好。</p>
    </a-card>

    <!-- 存储配置（A6）：上传根目录（配置项 storage.upload_dir）；保存后需重启 upload-service 生效 -->
    <StorageConfigCard />

    <a-card title="接入提示" style="margin-top: 16px;">
      <p style="color: #888; margin-bottom: 4px;">
        其他系统级设置（度量保留期等）后续按需收敛到本页；当前已有通知渠道与审批门禁两个能力。
      </p>
    </a-card>
  </div>
</template>

<style scoped>
/* 外观卡片：圆角风格说明（走语义 token，无裸色值） */
.appearance-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.appearance-label {
  font-size: 13px;
  color: var(--ws-text-secondary);
}
.appearance-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  line-height: 1.5;
}
</style>
