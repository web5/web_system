<template>
  <div class="settings">
    <a-page-header title="系统设置" sub-title="管理平台全局配置" />

    <a-tabs v-model:activeKey="tab" tab-position="left" class="settings-tabs">
      <!-- ========== 1. 基本设置 ========== -->
      <a-tab-pane key="basic" tab="基本设置">
        <a-card title="站点信息" size="small">
          <a-form :model="basicForm" layout="vertical" style="max-width: 480px">
            <a-form-item label="站点名称">
              <a-input v-model:value="basicForm.siteName" placeholder="科豆 AI" />
            </a-form-item>
            <a-form-item label="站点描述">
              <a-textarea v-model:value="basicForm.siteDesc" :rows="3" placeholder="科豆 AI 少儿教育平台" />
            </a-form-item>
            <a-form-item label="联系邮箱">
              <a-input v-model:value="basicForm.contactEmail" placeholder="admin@kedouai.com" />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" @click="saveBasic">保存</a-button>
              <a-button style="margin-left: 12px" @click="resetBasic">重置</a-button>
            </a-form-item>
          </a-form>
        </a-card>
      </a-tab-pane>

      <!-- ========== 2. 功能开关 ========== -->
      <a-tab-pane key="features" tab="功能开关">
        <a-card title="功能模块" size="small">
          <a-form layout="vertical" style="max-width: 480px">
            <a-form-item label="微信扫码登录">
              <a-switch v-model:checked="features.wechatLogin" checked-children="开" un-checked-children="关" />
            </a-form-item>
            <a-form-item label="账号密码登录">
              <a-switch v-model:checked="features.passwordLogin" checked-children="开" un-checked-children="关" />
            </a-form-item>
            <a-form-item label="用户自助注册">
              <a-switch v-model:checked="features.selfRegister" checked-children="开" un-checked-children="关" />
            </a-form-item>
            <a-form-item label="小程序端入口">
              <a-switch v-model:checked="features.miniAppEntry" checked-children="开" un-checked-children="关" />
            </a-form-item>
            <a-form-item label="评论功能">
              <a-switch v-model:checked="features.comments" checked-children="开" un-checked-children="关" />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" @click="saveFeatures">保存</a-button>
            </a-form-item>
          </a-form>
        </a-card>
      </a-tab-pane>

      <!-- ========== 3. 安全策略 ========== -->
      <a-tab-pane key="security" tab="安全策略">
        <a-card title="密码与登录安全" size="small">
          <a-form :model="security" layout="vertical" style="max-width: 480px">
            <a-form-item label="密码最小长度">
              <a-input-number v-model:value="security.pwdMinLength" :min="4" :max="32" style="width: 120px" /> 位
            </a-form-item>
            <a-form-item label="密码复杂度">
              <a-checkbox v-model:checked="security.pwdRequireDigit">必须含数字</a-checkbox>
              <a-checkbox v-model:checked="security.pwdRequireUpper" style="margin-left: 16px">必须含大写</a-checkbox>
              <a-checkbox v-model:checked="security.pwdRequireSpecial" style="margin-left: 16px">必须含特殊字符</a-checkbox>
            </a-form-item>
            <a-divider />
            <a-form-item label="登录失败锁定">
              连续失败
              <a-input-number v-model:value="security.lockThreshold" :min="1" :max="20" style="width: 80px; margin: 0 8px" />
              次后锁定
            </a-form-item>
            <a-form-item label="锁定时间">
              <a-input-number v-model:value="security.lockMinutes" :min="1" :max="1440" style="width: 100px" /> 分钟
            </a-form-item>
            <a-divider />
            <a-form-item label="Token 有效期">
              <a-input-number v-model:value="security.tokenExpireDays" :min="1" :max="365" style="width: 100px" /> 天
            </a-form-item>
            <a-form-item>
              <a-button type="primary" @click="saveSecurity">保存</a-button>
            </a-form-item>
          </a-form>
        </a-card>
      </a-tab-pane>

      <!-- ========== 4. 通知配置（二期） ========== -->
      <a-tab-pane key="notify" tab="通知配置">
        <a-card title="邮件通知（SMTP）" size="small">
          <a-form :model="notify.smtp" layout="vertical" style="max-width: 480px">
            <a-form-item label="SMTP 服务器">
              <a-input v-model:value="notify.smtp.host" placeholder="smtp.qq.com" />
            </a-form-item>
            <a-row :gutter="16">
              <a-col :span="12">
                <a-form-item label="端口">
                  <a-input-number v-model:value="notify.smtp.port" :min="1" :max="65535" style="width: 100%" />
                </a-form-item>
              </a-col>
              <a-col :span="12">
                <a-form-item label="加密方式">
                  <a-select v-model:value="notify.smtp.encryption">
                    <a-select-option value="ssl">SSL</a-select-option>
                    <a-select-option value="tls">TLS</a-select-option>
                    <a-select-option value="none">无</a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>
            </a-row>
            <a-form-item label="发件人邮箱">
              <a-input v-model:value="notify.smtp.from" placeholder="admin@kedouai.com" />
            </a-form-item>
            <a-form-item label="授权码">
              <a-input-password v-model:value="notify.smtp.pass" placeholder="SMTP 授权码" />
            </a-form-item>
            <a-form-item>
              <a-button @click="testEmail" style="margin-right: 12px">发送测试邮件</a-button>
              <a-button type="primary" @click="saveNotify">保存</a-button>
            </a-form-item>
          </a-form>
        </a-card>
      </a-tab-pane>

      <!-- ========== 5. 存储配置（二期） ========== -->
      <a-tab-pane key="storage" tab="存储配置">
        <a-card title="文件存储" size="small">
          <a-form layout="vertical" style="max-width: 480px">
            <a-form-item label="存储方式">
              <a-radio-group v-model:value="storage.type">
                <a-radio value="local">本地存储</a-radio>
                <a-radio value="aliyun">阿里云 OSS</a-radio>
                <a-radio value="tencent">腾讯 COS</a-radio>
              </a-radio-group>
            </a-form-item>
            <template v-if="storage.type !== 'local'">
              <a-form-item label="Bucket">
                <a-input v-model:value="storage.bucket" placeholder="bucket-name" />
              </a-form-item>
              <a-form-item label="Region">
                <a-input v-model:value="storage.region" placeholder="oss-cn-hangzhou" />
              </a-form-item>
              <a-form-item label="AccessKey">
                <a-input v-model:value="storage.accessKey" placeholder="AccessKey ID" />
              </a-form-item>
              <a-form-item label="SecretKey">
                <a-input-password v-model:value="storage.secretKey" placeholder="AccessKey Secret" />
              </a-form-item>
            </template>
            <a-form-item label="上传大小限制">
              <a-input-number v-model:value="storage.maxUploadMB" :min="1" :max="100" style="width: 100px" /> MB
            </a-form-item>
            <a-form-item>
              <a-button type="primary" @click="saveStorage">保存</a-button>
            </a-form-item>
          </a-form>
        </a-card>
      </a-tab-pane>

      <!-- ========== 6. 操作日志（二期） ========== -->
      <a-tab-pane key="logs" tab="操作日志">
        <a-card size="small">
          <a-form layout="inline" style="margin-bottom: 16px">
            <a-form-item label="时间">
              <a-range-picker v-model:value="logFilter.dateRange" />
            </a-form-item>
            <a-form-item label="操作人">
              <a-input v-model:value="logFilter.operator" placeholder="用户名" style="width: 140px" allow-clear />
            </a-form-item>
            <a-form-item label="类型">
              <a-select v-model:value="logFilter.type" style="width: 130px" allow-clear placeholder="全部">
                <a-select-option value="login">登录</a-select-option>
                <a-select-option value="logout">退出</a-select-option>
                <a-select-option value="update_setting">修改设置</a-select-option>
                <a-select-option value="create_user">创建用户</a-select-option>
                <a-select-option value="delete">删除</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item>
              <a-button type="primary" @click="searchLogs">查询</a-button>
            </a-form-item>
          </a-form>

          <a-table
            :columns="logColumns"
            :data-source="logs"
            :pagination="logPagination"
            :loading="logLoading"
            size="small"
            @change="onLogPageChange"
          />
        </a-card>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import type { Dayjs } from 'dayjs';
import { getSettings, updateSettings, getLogs } from '@/api/settings';

// ====== Tab 状态 ======
const tab = ref('basic');

// ====== 配置字段 key 映射 ======
const KEY = {
  siteName: 'site_name',
  siteDesc: 'site_description',
  contactEmail: 'contact_email',
  wechatLogin: 'feature_wechat_login',
  passwordLogin: 'feature_password_login',
  selfRegister: 'feature_self_register',
  miniAppEntry: 'feature_mini_app',
  comments: 'feature_comments',
  pwdMinLength: 'security_pwd_min_length',
  pwdRequireDigit: 'security_pwd_require_digit',
  pwdRequireUpper: 'security_pwd_require_upper',
  pwdRequireSpecial: 'security_pwd_require_special',
  lockThreshold: 'security_lock_threshold',
  lockMinutes: 'security_lock_minutes',
  tokenExpireDays: 'security_token_expire_days',
  smtpHost: 'notify_smtp_host',
  smtpPort: 'notify_smtp_port',
  smtpEncryption: 'notify_smtp_encryption',
  smtpFrom: 'notify_smtp_from',
  smtpPass: 'notify_smtp_pass',
  storageType: 'storage_type',
  storageBucket: 'storage_bucket',
  storageRegion: 'storage_region',
  maxUploadMB: 'storage_max_upload_mb',
};

// ====== 1. 基本设置 ======
const basicForm = reactive({ siteName: '科豆 AI', siteDesc: '科豆 AI 少儿教育平台', contactEmail: 'admin@kedouai.com' });
const saveBasic = () => doSave({ [KEY.siteName]: basicForm.siteName, [KEY.siteDesc]: basicForm.siteDesc, [KEY.contactEmail]: basicForm.contactEmail });
const resetBasic = () => { basicForm.siteName = '科豆 AI'; basicForm.siteDesc = '科豆 AI 少儿教育平台'; basicForm.contactEmail = 'admin@kedouai.com'; };

// ====== 2. 功能开关 ======
const features = reactive({ wechatLogin: true, passwordLogin: true, selfRegister: true, miniAppEntry: true, comments: false });
const saveFeatures = () => doSave({
  [KEY.wechatLogin]: features.wechatLogin ? '1' : '0',
  [KEY.passwordLogin]: features.passwordLogin ? '1' : '0',
  [KEY.selfRegister]: features.selfRegister ? '1' : '0',
  [KEY.miniAppEntry]: features.miniAppEntry ? '1' : '0',
  [KEY.comments]: features.comments ? '1' : '0',
});

// ====== 3. 安全策略 ======
const security = reactive({ pwdMinLength: 8, pwdRequireDigit: true, pwdRequireUpper: false, pwdRequireSpecial: false, lockThreshold: 5, lockMinutes: 30, tokenExpireDays: 7 });
const saveSecurity = () => doSave({
  [KEY.pwdMinLength]: String(security.pwdMinLength),
  [KEY.pwdRequireDigit]: security.pwdRequireDigit ? '1' : '0',
  [KEY.pwdRequireUpper]: security.pwdRequireUpper ? '1' : '0',
  [KEY.pwdRequireSpecial]: security.pwdRequireSpecial ? '1' : '0',
  [KEY.lockThreshold]: String(security.lockThreshold),
  [KEY.lockMinutes]: String(security.lockMinutes),
  [KEY.tokenExpireDays]: String(security.tokenExpireDays),
});

// ====== 4. 通知配置 ======
const notify = reactive({ smtp: { host: '', port: 465, encryption: 'ssl', from: '', pass: '' } });
const saveNotify = () => doSave({
  [KEY.smtpHost]: notify.smtp.host,
  [KEY.smtpPort]: String(notify.smtp.port),
  [KEY.smtpEncryption]: notify.smtp.encryption,
  [KEY.smtpFrom]: notify.smtp.from,
  [KEY.smtpPass]: notify.smtp.pass,
});
const testEmail = () => message.info('测试邮件已发送，请查收（模拟）');

// ====== 5. 存储配置 ======
const storage = reactive({ type: 'local', bucket: '', region: '', accessKey: '', secretKey: '', maxUploadMB: 10 });
const saveStorage = () => doSave({
  [KEY.storageType]: storage.type,
  [KEY.storageBucket]: storage.bucket,
  [KEY.storageRegion]: storage.region,
  [KEY.maxUploadMB]: String(storage.maxUploadMB),
});

// ====== 通用保存 ======
async function doSave(data: Record<string, string>) {
  try {
    await updateSettings(data);
    message.success('保存成功');
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败');
  }
}

// ====== 6. 操作日志 ======
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
      page: logPagination.current,
      pageSize: logPagination.pageSize,
      operator: logFilter.operator || undefined,
      type: logFilter.type || undefined,
      startTime: logFilter.dateRange?.[0]?.toISOString(),
      endTime: logFilter.dateRange?.[1]?.toISOString(),
    });
    logs.value = res.items;
    logPagination.total = res.total;
  } catch { /* ignore */ }
  finally { logLoading.value = false; }
};

const onLogPageChange = (pag: any) => { logPagination.current = pag.current; logPagination.pageSize = pag.pageSize; searchLogs(); };

// ====== 初始化：从后端加载配置 ======
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
.settings {
  padding: 0;
}
.settings-tabs {
  min-height: 60vh;
}
</style>
