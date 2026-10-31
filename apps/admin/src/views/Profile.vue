<template>
  <div class="profile-page">
    <div class="page-header">
      <h1 class="page-title">个人中心</h1>
      <p class="page-subtitle">查看账号信息，修改登录密码</p>
    </div>

    <a-row :gutter="16">
      <a-col :xs="24" :lg="12">
        <div class="section-card">
          <div class="section-title">
            <IdcardOutlined class="section-icon" />
            <span>基本信息</span>
          </div>
          <a-descriptions :column="1" bordered>
            <a-descriptions-item label="头像">
              <a-avatar :size="64" :src="avatarSrc" />
            </a-descriptions-item>
            <a-descriptions-item label="用户名">{{ userInfo?.username || '-' }}</a-descriptions-item>
            <a-descriptions-item label="昵称">{{ userInfo?.nickname || '-' }}</a-descriptions-item>
            <a-descriptions-item label="邮箱">{{ userInfo?.email || '-' }}</a-descriptions-item>
            <a-descriptions-item label="手机号">{{ userInfo?.phone || '-' }}</a-descriptions-item>
            <a-descriptions-item label="角色">
              <a-tag :color="userInfo?.roles?.includes('admin') ? 'red' : 'blue'">{{ roleLabel }}</a-tag>
            </a-descriptions-item>
          </a-descriptions>
        </div>
      </a-col>

      <a-col :xs="24" :lg="12">
        <div class="section-card">
          <div class="section-title">
            <LockOutlined class="section-icon" />
            <span>修改密码</span>
          </div>
          <a-form :model="pwdForm" layout="vertical" class="pwd-form" @finish="submitChange">
            <a-form-item label="旧密码" name="oldPwd" :rules="[{ required: true, message: '请输入旧密码' }]">
              <a-input-password
                v-model:value="pwdForm.oldPwd"
                placeholder="请输入旧密码"
                size="large"
              />
            </a-form-item>
            <a-form-item label="新密码" name="newPwd" :rules="[{ required: true, min: 6, message: '新密码至少 6 位' }]">
              <a-input-password
                v-model:value="pwdForm.newPwd"
                placeholder="至少 6 位"
                size="large"
              />
            </a-form-item>
            <a-form-item label="确认新密码" name="confirmPwd" :rules="[{ validator: validateConfirm }]">
              <a-input-password
                v-model:value="pwdForm.confirmPwd"
                placeholder="再次输入新密码"
                size="large"
              />
            </a-form-item>
            <a-button type="primary" html-type="submit" size="large" :loading="submitting">修改密码</a-button>
          </a-form>
        </div>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { IdcardOutlined, LockOutlined } from '@ant-design/icons-vue';
import { changeMyPassword } from '@/api/user';
import { logout as logoutApi } from '@/api/auth';
import { useUserStore } from '@/stores/user';

/** 公共静态资源前缀（模板用，见 BasicLayout 同款约束） */
const assetBase = __PUBLIC_ASSET_BASE__;

const router = useRouter();
const userStore = useUserStore();
const submitting = ref(false);

const userInfo = computed(() => userStore.userInfo);

const avatarSrc = computed(() => {
  const info = userInfo.value;
  if (info?.avatar) return info.avatar;
  return info?.gender === 'female'
    ? `${assetBase}avatars/default-female.png`
    : `${assetBase}avatars/default-male.png`;
});

const roleLabel = computed(() => {
  const roles = (userInfo.value?.roles as string[]) || [];
  if (roles.includes('admin')) return '管理员';
  if (roles.includes('editor')) return '编辑';
  if (roles.includes('viewer')) return '只读';
  return '普通用户';
});

const pwdForm = reactive({ oldPwd: '', newPwd: '', confirmPwd: '' });

function validateConfirm(_rule: unknown, value: string) {
  if (!value) return Promise.reject('请再次输入新密码');
  if (value !== pwdForm.newPwd) return Promise.reject('两次输入的新密码不一致');
  return Promise.resolve();
}

async function submitChange() {
  submitting.value = true;
  try {
    await changeMyPassword(pwdForm.oldPwd, pwdForm.newPwd);
    message.success('密码修改成功，请重新登录');
    // 改密后令牌版本 +1，当前会话已被作废，直接登出跳登录
    try { await logoutApi(); } catch { /* ignore */ }
    userStore.logout();
    router.push('/login');
  } catch {
    // 旧密码错误等业务错误已由 request 拦截器统一提示，此处仅兜底
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.profile-page {
  padding: 8px 0;
}
.page-header {
  margin-bottom: 20px;
}
.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--text-heading);
  letter-spacing: -0.3px;
}
.page-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-muted);
}
.section-card {
  background: linear-gradient(135deg, var(--card-bg-start) 0%, var(--card-bg-end) 100%);
  border: 1px solid var(--card-border);
  border-radius: var(--r-card);
  padding: 24px;
  margin-bottom: 16px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-heading);
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-divider);
}
.section-icon {
  font-size: 18px;
  color: #FF8C42;
}
.pwd-form {
  max-width: 360px;
}
.pwd-form :deep(.ant-input-affix-wrapper) {
  background: var(--input-bg);
  border-color: var(--input-border);
  border-radius: var(--r-control);
}
.pwd-form :deep(.ant-input-affix-wrapper:hover),
.pwd-form :deep(.ant-input-affix-wrapper-focused) {
  border-color: rgba(255, 140, 66, 0.4);
  box-shadow: 0 0 0 2px rgba(255, 140, 66, 0.12);
}
.pwd-form :deep(.ant-form-item-label > label) {
  color: var(--text-tertiary);
  font-size: 13px;
}
</style>
