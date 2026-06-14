<template>
  <div class="settings-page">
    <!-- 页头 -->
    <div class="settings-header">
      <div class="settings-header-left">
        <h2 class="settings-title">系统设置</h2>
        <p class="settings-subtitle">管理平台全局配置，包括站点信息、安全策略、通知与存储</p>
      </div>
    </div>

    <div class="settings-body">
      <a-tabs v-model:activeKey="tab" class="settings-tabs">
        <a-tab-pane key="basic" tab="基本信息">
          <div class="tab-content">
            <div class="section-card">
              <div class="section-title">
                <AppstoreOutlined class="section-icon" />
                <span>站点信息</span>
              </div>
              <a-form :model="basicForm" layout="vertical" class="settings-form">
                <a-form-item label="站点名称">
                  <a-input v-model:value="basicForm.siteName" placeholder="科豆 AI" size="large" />
                </a-form-item>
                <a-form-item label="站点描述">
                  <a-textarea v-model:value="basicForm.siteDesc" :rows="3" placeholder="科豆 AI 少儿教育平台" size="large" />
                </a-form-item>
                <a-form-item label="联系邮箱">
                  <a-input v-model:value="basicForm.contactEmail" placeholder="admin@kedouai.com" size="large" />
                </a-form-item>
                <div class="form-actions">
                  <a-button type="primary" size="large" :loading="savingBasic" @click="saveBasic">保存修改</a-button>
                  <a-button size="large" @click="resetBasic">恢复默认</a-button>
                </div>
              </a-form>
            </div>
          </div>
        </a-tab-pane>

        <a-tab-pane key="features" tab="功能开关">
          <div class="tab-content">
            <div class="section-card">
              <div class="section-title">
                <ControlOutlined class="section-icon" />
                <span>功能模块</span>
              </div>
              <a-form layout="vertical" class="settings-form">
                <div class="switch-list">
                  <div class="switch-item">
                    <div class="switch-item-info">
                      <span class="switch-item-label">微信扫码登录</span>
                      <span class="switch-item-desc">允许用户通过微信公众号扫码登录</span>
                    </div>
                    <a-switch v-model:checked="features.wechatLogin" />
                  </div>
                  <div class="switch-item">
                    <div class="switch-item-info">
                      <span class="switch-item-label">账号密码登录</span>
                      <span class="switch-item-desc">允许用户使用用户名和密码登录</span>
                    </div>
                    <a-switch v-model:checked="features.passwordLogin" />
                  </div>
                  <div class="switch-item">
                    <div class="switch-item-info">
                      <span class="switch-item-label">用户自助注册</span>
                      <span class="switch-item-desc">允许新用户自行注册账号</span>
                    </div>
                    <a-switch v-model:checked="features.selfRegister" />
                  </div>
                  <div class="switch-item">
                    <div class="switch-item-info">
                      <span class="switch-item-label">小程序端入口</span>
                      <span class="switch-item-desc">开放微信小程序端访问入口</span>
                    </div>
                    <a-switch v-model:checked="features.miniAppEntry" />
                  </div>
                  <div class="switch-item">
                    <div class="switch-item-info">
                      <span class="switch-item-label">评论功能</span>
                      <span class="switch-item-desc">允许用户对内容进行评论</span>
                    </div>
                    <a-switch v-model:checked="features.comments" />
                  </div>
                </div>
                <div class="form-actions">
                  <a-button type="primary" size="large" :loading="savingFeatures" @click="saveFeatures">保存修改</a-button>
                </div>
              </a-form>
            </div>
          </div>
        </a-tab-pane>

        <a-tab-pane key="security" tab="安全策略">
          <div class="tab-content">
            <div class="section-card">
              <div class="section-title">
                <SafetyCertificateOutlined class="section-icon" />
                <span>密码与登录安全</span>
              </div>
              <a-form :model="security" layout="vertical" class="settings-form">
                <a-form-item label="密码最小长度">
                  <a-input-number v-model:value="security.pwdMinLength" :min="4" :max="32" size="large" style="width: 120px" />
                  <span class="unit-text">位</span>
                </a-form-item>
                <a-form-item label="密码复杂度要求">
                  <a-checkbox v-model:checked="security.pwdRequireDigit">须包含数字</a-checkbox>
                  <a-checkbox v-model:checked="security.pwdRequireUpper" style="margin-left: 20px">须包含大写字母</a-checkbox>
                  <a-checkbox v-model:checked="security.pwdRequireSpecial" style="margin-left: 20px">须包含特殊字符</a-checkbox>
                </a-form-item>
                <a-divider class="section-divider" />
                <a-form-item label="登录失败锁定">
                  <span class="inline-label">连续失败</span>
                  <a-input-number v-model:value="security.lockThreshold" :min="1" :max="20" size="large" style="width: 80px; margin: 0 8px" />
                  <span class="unit-text">次后锁定</span>
                </a-form-item>
                <a-form-item label="锁定时间">
                  <a-input-number v-model:value="security.lockMinutes" :min="1" :max="1440" size="large" style="width: 100px" />
                  <span class="unit-text">分钟</span>
                </a-form-item>
                <a-divider class="section-divider" />
                <a-form-item label="登录有效期">
                  <a-input-number v-model:value="security.tokenExpireDays" :min="1" :max="365" size="large" style="width: 100px" />
                  <span class="unit-text">天</span>
                </a-form-item>
                <div class="form-actions">
                  <a-button type="primary" size="large" :loading="savingSecurity" @click="saveSecurity">保存修改</a-button>
                </div>
              </a-form>
            </div>
          </div>
        </a-tab-pane>

        <a-tab-pane key="notify" tab="通知配置">
          <div class="tab-content">
            <div class="section-card">
              <div class="section-title">
                <MailOutlined class="section-icon" />
                <span>邮件通知 (SMTP)</span>
              </div>
              <a-form :model="notify.smtp" layout="vertical" class="settings-form">
                <a-form-item label="SMTP 服务器">
                  <a-input v-model:value="notify.smtp.host" placeholder="smtp.qq.com" size="large" />
                </a-form-item>
                <a-row :gutter="16">
                  <a-col :span="12">
                    <a-form-item label="端口">
                      <a-input-number v-model:value="notify.smtp.port" :min="1" :max="65535" size="large" style="width: 100%" />
                    </a-form-item>
                  </a-col>
                  <a-col :span="12">
                    <a-form-item label="加密方式">
                      <a-select v-model:value="notify.smtp.encryption" size="large">
                        <a-select-option value="ssl">SSL</a-select-option>
                        <a-select-option value="tls">TLS</a-select-option>
                        <a-select-option value="none">无</a-select-option>
                      </a-select>
                    </a-form-item>
                  </a-col>
                </a-row>
                <a-form-item label="发件人邮箱">
                  <a-input v-model:value="notify.smtp.from" placeholder="admin@kedouai.com" size="large" />
                </a-form-item>
                <a-form-item label="授权码">
                  <a-input-password v-model:value="notify.smtp.pass" placeholder="SMTP 授权码" size="large" />
                </a-form-item>
                <div class="form-actions">
                  <a-button @click="testEmail" size="large">发送测试邮件</a-button>
                  <a-button type="primary" size="large" :loading="savingNotify" @click="saveNotify">保存修改</a-button>
                </div>
              </a-form>
            </div>
          </div>
        </a-tab-pane>

        <a-tab-pane key="storage" tab="存储配置">
          <div class="tab-content">
            <div class="section-card">
              <div class="section-title">
                <CloudOutlined class="section-icon" />
                <span>文件存储</span>
              </div>
              <a-form layout="vertical" class="settings-form">
                <a-form-item label="存储方式">
                  <a-radio-group v-model:value="storage.type">
                    <a-radio value="local">本地存储</a-radio>
                    <a-radio value="aliyun">阿里云 OSS</a-radio>
                    <a-radio value="tencent">腾讯 COS</a-radio>
                  </a-radio-group>
                </a-form-item>
                <template v-if="storage.type !== 'local'">
                  <a-form-item label="Bucket">
                    <a-input v-model:value="storage.bucket" placeholder="bucket-name" size="large" />
                  </a-form-item>
                  <a-form-item label="Region">
                    <a-input v-model:value="storage.region" placeholder="oss-cn-hangzhou" size="large" />
                  </a-form-item>
                  <a-form-item label="AccessKey">
                    <a-input v-model:value="storage.accessKey" placeholder="AccessKey ID" size="large" />
                  </a-form-item>
                  <a-form-item label="SecretKey">
                    <a-input-password v-model:value="storage.secretKey" placeholder="AccessKey Secret" size="large" />
                  </a-form-item>
                </template>
                <a-form-item label="上传大小限制">
                  <a-input-number v-model:value="storage.maxUploadMB" :min="1" :max="100" size="large" style="width: 100px" />
                  <span class="unit-text">MB</span>
                </a-form-item>
                <div class="form-actions">
                  <a-button type="primary" size="large" :loading="savingStorage" @click="saveStorage">保存修改</a-button>
                </div>
              </a-form>
            </div>
          </div>
        </a-tab-pane>

        <a-tab-pane key="logs" tab="操作日志">
          <div class="tab-content">
            <div class="section-card">
              <div class="section-title">
                <FileSearchOutlined class="section-icon" />
                <span>操作记录</span>
              </div>
              <div class="log-filters">
                <a-space :size="12" wrap>
                  <a-range-picker v-model:value="logFilter.dateRange" />
                  <a-input v-model:value="logFilter.operator" placeholder="操作人" style="width: 140px" allow-clear />
                  <a-select v-model:value="logFilter.type" style="width: 130px" allow-clear placeholder="全部类型">
                    <a-select-option value="login">登录</a-select-option>
                    <a-select-option value="logout">退出</a-select-option>
                    <a-select-option value="update_setting">修改设置</a-select-option>
                    <a-select-option value="create_user">创建用户</a-select-option>
                    <a-select-option value="delete">删除</a-select-option>
                  </a-select>
                  <a-button type="primary" @click="searchLogs">查询</a-button>
                </a-space>
              </div>
              <a-table
                :columns="logColumns"
                :data-source="logs"
                :pagination="logPagination"
                :loading="logLoading"
                size="small"
                class="dark-table"
                @change="onLogPageChange"
              />
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import type { Dayjs } from 'dayjs';
import {
  AppstoreOutlined, ControlOutlined, SafetyCertificateOutlined,
  MailOutlined, CloudOutlined, FileSearchOutlined,
} from '@ant-design/icons-vue';
import { getSettings, updateSettings, getLogs } from '@/api/settings';

const tab = ref('basic');
const savingBasic = ref(false);
const savingFeatures = ref(false);
const savingSecurity = ref(false);
const savingNotify = ref(false);
const savingStorage = ref(false);

const KEY = {
  siteName: 'site_name', siteDesc: 'site_description', contactEmail: 'contact_email',
  wechatLogin: 'feature_wechat_login', passwordLogin: 'feature_password_login',
  selfRegister: 'feature_self_register', miniAppEntry: 'feature_mini_app', comments: 'feature_comments',
  pwdMinLength: 'security_pwd_min_length', pwdRequireDigit: 'security_pwd_require_digit',
  pwdRequireUpper: 'security_pwd_require_upper', pwdRequireSpecial: 'security_pwd_require_special',
  lockThreshold: 'security_lock_threshold', lockMinutes: 'security_lock_minutes', tokenExpireDays: 'security_token_expire_days',
  smtpHost: 'notify_smtp_host', smtpPort: 'notify_smtp_port', smtpEncryption: 'notify_smtp_encryption',
  smtpFrom: 'notify_smtp_from', smtpPass: 'notify_smtp_pass',
  storageType: 'storage_type', storageBucket: 'storage_bucket', storageRegion: 'storage_region', maxUploadMB: 'storage_max_upload_mb',
};

const basicForm = reactive({ siteName: '科豆 AI', siteDesc: '科豆 AI 少儿教育平台', contactEmail: 'admin@kedouai.com' });
const saveBasic = () => doSave({ [KEY.siteName]: basicForm.siteName, [KEY.siteDesc]: basicForm.siteDesc, [KEY.contactEmail]: basicForm.contactEmail }, savingBasic);
const resetBasic = () => { basicForm.siteName = '科豆 AI'; basicForm.siteDesc = '科豆 AI 少儿教育平台'; basicForm.contactEmail = 'admin@kedouai.com'; };

const features = reactive({ wechatLogin: true, passwordLogin: true, selfRegister: true, miniAppEntry: true, comments: false });
const saveFeatures = () => doSave({
  [KEY.wechatLogin]: features.wechatLogin ? '1' : '0', [KEY.passwordLogin]: features.passwordLogin ? '1' : '0',
  [KEY.selfRegister]: features.selfRegister ? '1' : '0', [KEY.miniAppEntry]: features.miniAppEntry ? '1' : '0',
  [KEY.comments]: features.comments ? '1' : '0',
}, savingFeatures);

const security = reactive({ pwdMinLength: 8, pwdRequireDigit: true, pwdRequireUpper: false, pwdRequireSpecial: false, lockThreshold: 5, lockMinutes: 30, tokenExpireDays: 7 });
const saveSecurity = () => doSave({
  [KEY.pwdMinLength]: String(security.pwdMinLength), [KEY.pwdRequireDigit]: security.pwdRequireDigit ? '1' : '0',
  [KEY.pwdRequireUpper]: security.pwdRequireUpper ? '1' : '0', [KEY.pwdRequireSpecial]: security.pwdRequireSpecial ? '1' : '0',
  [KEY.lockThreshold]: String(security.lockThreshold), [KEY.lockMinutes]: String(security.lockMinutes), [KEY.tokenExpireDays]: String(security.tokenExpireDays),
}, savingSecurity);

const notify = reactive({ smtp: { host: '', port: 465, encryption: 'ssl', from: '', pass: '' } });
const saveNotify = () => doSave({
  [KEY.smtpHost]: notify.smtp.host, [KEY.smtpPort]: String(notify.smtp.port),
  [KEY.smtpEncryption]: notify.smtp.encryption, [KEY.smtpFrom]: notify.smtp.from, [KEY.smtpPass]: notify.smtp.pass,
}, savingNotify);
const testEmail = () => message.info('测试邮件已发送，请查收（模拟）');

const storage = reactive({ type: 'local', bucket: '', region: '', accessKey: '', secretKey: '', maxUploadMB: 10 });
const saveStorage = () => doSave({
  [KEY.storageType]: storage.type, [KEY.storageBucket]: storage.bucket,
  [KEY.storageRegion]: storage.region, [KEY.maxUploadMB]: String(storage.maxUploadMB),
}, savingStorage);

async function doSave(data: Record<string, string>, loadingRef: Ref<boolean>) {
  loadingRef.value = true;
  try {
    await updateSettings(data);
    message.success('保存成功');
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败');
  } finally {
    loadingRef.value = false;
  }
}

import type { Ref } from 'vue';

const logLoading = ref(false);
const logFilter = reactive({
  dateRange: null as [Dayjs, Dayjs] | null,
  operator: '',
  type: undefined as string | undefined,
});

const logColumns = [
  { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
  { title: '操作人', dataIndex: 'operator', key: 'operator', width: 100 },
  { title: '类型', dataIndex: 'type', key: 'type', width: 110 },
  { title: '操作目标', dataIndex: 'target', key: 'target', ellipsis: true },
  { title: 'IP', dataIndex: 'ip', key: 'ip', width: 140 },
];

const logs = ref<any[]>([]);
const logPagination = reactive({ current: 1, pageSize: 20, total: 0, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` });

const searchLogs = async () => {
  logLoading.value = true;
  try {
    const res = await getLogs({
      page: logPagination.current, pageSize: logPagination.pageSize,
      operator: logFilter.operator || undefined, type: logFilter.type || undefined,
      startTime: logFilter.dateRange?.[0]?.toISOString(), endTime: logFilter.dateRange?.[1]?.toISOString(),
    });
    logs.value = res.items;
    logPagination.total = res.total;
  } catch { /* ignore */ }
  finally { logLoading.value = false; }
};

const onLogPageChange = (pag: any) => { logPagination.current = pag.current; logPagination.pageSize = pag.pageSize; searchLogs(); };

onMounted(async () => {
  try {
    const cfg = await getSettings();
    if (cfg[KEY.siteName]) basicForm.siteName = cfg[KEY.siteName];
    if (cfg[KEY.siteDesc]) basicForm.siteDesc = cfg[KEY.siteDesc];
    if (cfg[KEY.contactEmail]) basicForm.contactEmail = cfg[KEY.contactEmail];
    features.wechatLogin = cfg[KEY.wechatLogin] !== '0';
    features.passwordLogin = cfg[KEY.passwordLogin] !== '0';
    features.selfRegister = cfg[KEY.selfRegister] !== '0';
    features.miniAppEntry = cfg[KEY.miniAppEntry] !== '0';
    features.comments = cfg[KEY.comments] === '1';
    if (cfg[KEY.pwdMinLength]) security.pwdMinLength = parseInt(cfg[KEY.pwdMinLength]);
    security.pwdRequireDigit = cfg[KEY.pwdRequireDigit] !== '0';
    security.pwdRequireUpper = cfg[KEY.pwdRequireUpper] === '1';
    security.pwdRequireSpecial = cfg[KEY.pwdRequireSpecial] === '1';
    if (cfg[KEY.lockThreshold]) security.lockThreshold = parseInt(cfg[KEY.lockThreshold]);
    if (cfg[KEY.lockMinutes]) security.lockMinutes = parseInt(cfg[KEY.lockMinutes]);
    if (cfg[KEY.tokenExpireDays]) security.tokenExpireDays = parseInt(cfg[KEY.tokenExpireDays]);
    if (cfg[KEY.smtpHost]) notify.smtp.host = cfg[KEY.smtpHost];
    if (cfg[KEY.smtpPort]) notify.smtp.port = parseInt(cfg[KEY.smtpPort]);
    if (cfg[KEY.smtpEncryption]) notify.smtp.encryption = cfg[KEY.smtpEncryption];
    if (cfg[KEY.smtpFrom]) notify.smtp.from = cfg[KEY.smtpFrom];
    if (cfg[KEY.smtpPass]) notify.smtp.pass = cfg[KEY.smtpPass];
    if (cfg[KEY.storageType]) storage.type = cfg[KEY.storageType];
    if (cfg[KEY.storageBucket]) storage.bucket = cfg[KEY.storageBucket];
    if (cfg[KEY.storageRegion]) storage.region = cfg[KEY.storageRegion];
    if (cfg[KEY.maxUploadMB]) storage.maxUploadMB = parseInt(cfg[KEY.maxUploadMB]);
  } catch { /* server may not be ready */ }
  searchLogs();
});
</script>

<style scoped>
.settings-page { padding: 8px 0; }

/* 页头 */
.settings-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 0;
}
.settings-title { margin: 0; font-size: 22px; font-weight: 700; color: #F1F5F9; }
.settings-subtitle { margin: 4px 0 0; font-size: 13px; color: #64748B; }

/* 主体 */
.settings-body { margin-top: 20px; }

/* 标签页 */
.settings-tabs :deep(.ant-tabs-nav) { margin-bottom: 0; }
.settings-tabs :deep(.ant-tabs-tab) {
  color: #94A3B8 !important; font-size: 14px; padding: 12px 20px;
  transition: color .2s;
}
.settings-tabs :deep(.ant-tabs-tab:hover) { color: #FF8C42 !important; }
.settings-tabs :deep(.ant-tabs-tab-active .ant-tabs-tab-btn) { color: #FF8C42 !important; }
.settings-tabs :deep(.ant-tabs-ink-bar) { background: #FF8C42; }
.settings-tabs :deep(.ant-tabs-content-holder) { padding-top: 20px; }

/* 内容区 */
.tab-content { max-width: 680px; }
.section-card {
  background: linear-gradient(135deg, #141419 0%, #16161C 100%);
  border: 1px solid rgba(255,255,255,.06); border-radius: 12px; padding: 28px 32px;
}
.section-title {
  display: flex; align-items: center; gap: 10px;
  font-size: 15px; font-weight: 600; color: #F1F5F9;
  margin-bottom: 24px; padding-bottom: 16px;
  border-bottom: 1px solid rgba(255,255,255,.05);
}
.section-icon { font-size: 18px; color: #FF8C42; }

/* 表单 */
.settings-form { max-width: 520px; }
.settings-form :deep(.ant-form-item-label > label) { color: #94A3B8; font-size: 13px; }
.settings-form :deep(.ant-input), .settings-form :deep(.ant-input-affix-wrapper), .settings-form :deep(.ant-input-number), .settings-form :deep(.ant-select-selector) {
  background: rgba(255,255,255,.04) !important; border-color: rgba(255,255,255,.08) !important; color: #E2E8F0;
  border-radius: 8px;
}
.settings-form :deep(.ant-input::placeholder), .settings-form :deep(.ant-select-selection-placeholder) { color: #475569; }
.settings-form :deep(.ant-input:hover), .settings-form :deep(.ant-input-affix-wrapper:hover), .settings-form :deep(.ant-input-number:hover), .settings-form :deep(.ant-select:hover .ant-select-selector) {
  border-color: rgba(255,140,66,.4) !important;
}
.settings-form :deep(.ant-input:focus), .settings-form :deep(.ant-input-affix-wrapper-focused), .settings-form :deep(.ant-input-number-focused), .settings-form :deep(.ant-select-focused .ant-select-selector) {
  border-color: #FF8C42 !important; box-shadow: 0 0 0 2px rgba(255,140,66,.12);
}
.settings-form :deep(.ant-checkbox-wrapper) { color: #CBD5E1; font-size: 13px; }
.settings-form :deep(.ant-radio-wrapper) { color: #CBD5E1; }
.settings-form :deep(.ant-divider) { border-color: rgba(255,255,255,.06); }
.unit-text { margin-left: 8px; color: #64748B; font-size: 13px; }
.inline-label { color: #CBD5E1; font-size: 13px; }
.section-divider { margin: 24px 0 !important; }

.form-actions {
  display: flex; gap: 12px; margin-top: 16px;
  padding-top: 20px; border-top: 1px solid rgba(255,255,255,.05);
}

/* 开关列表 */
.switch-list { display: flex; flex-direction: column; gap: 0; }
.switch-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,.04);
}
.switch-item:last-child { border-bottom: none; }
.switch-item-info { display: flex; flex-direction: column; gap: 2px; }
.switch-item-label { font-size: 14px; color: #E2E8F0; font-weight: 500; }
.switch-item-desc { font-size: 12px; color: #64748B; }

/* 日志 */
.log-filters { margin-bottom: 16px; }

/* 暗色表格 */
.dark-table :deep(.ant-table) { background: transparent; color: #E2E8F0; }
.dark-table :deep(.ant-table-thead > tr > th) {
  background: rgba(255,255,255,.03) !important; color: #94A3B8;
  font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px;
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.dark-table :deep(.ant-table-tbody > tr > td) { border-bottom: 1px solid rgba(255,255,255,.03); }
.dark-table :deep(.ant-table-tbody > tr:hover > td) { background: rgba(255,140,66,.04) !important; }
.dark-table :deep(.ant-pagination-item-active) { border-color: #FF8C42; }
.dark-table :deep(.ant-pagination-item-active a) { color: #FF8C42; }
</style>
