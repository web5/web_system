<template>
  <div class="login-card">
    <!-- 关闭按钮（弹窗模式下显示） -->
    <button v-if="closable" class="card-close" @click="$emit('close')">✕</button>

    <!-- 品牌区 -->
    <div class="brand-section">
      <div class="brand-icon">
        <img src="/logo.svg" alt="科豆 AI" class="brand-logo" width="52" height="52" />
      </div>
      <h1 class="brand-name">科豆 AI</h1>
      <p class="brand-desc">开启智能学习之旅</p>
    </div>

    <!-- 登录方式切换 -->
    <div class="login-tabs">
      <template v-if="inWechat">
        <button :class="['tab-btn', { active: loginMode === 'oauth' }]" @click="loginMode = 'oauth'">
          <WechatOutlined />
          <span>微信登录</span>
        </button>
      </template>
      <template v-else>
        <button :class="['tab-btn', { active: loginMode === 'qrcode' }]" @click="loginMode = 'qrcode'">
          <MobileOutlined />
          <span>扫码登录</span>
        </button>
      </template>
      <button :class="['tab-btn', { active: loginMode === 'account' }]" @click="loginMode = 'account'">
        <UserOutlined />
        <span>账号登录</span>
      </button>
    </div>

    <!-- 微信 OAuth 一键登录 -->
    <div v-if="loginMode === 'oauth'" class="panel oauth-panel">
      <div class="oauth-wechat-icon"><WechatOutlined /></div>
      <p class="oauth-title">微信一键登录</p>
      <p class="oauth-desc">检测到您已登录微信，点击下方按钮即可快速登录</p>
      <a-button class="oauth-btn" size="large" block @click="handleWechatOAuth">
        <WechatOutlined />微信授权登录
      </a-button>
    </div>

    <!-- 扫码登录 -->
    <div v-if="loginMode === 'qrcode'" class="panel qrcode-panel">
      <template v-if="qrcodeStatus === 'pending'">
        <div class="qrcode-frame"><canvas ref="canvasRef" class="qrcode-canvas"></canvas></div>
        <div class="qrcode-info">
          <p class="qrcode-tip">请使用微信扫一扫登录</p>
          <p class="qrcode-expire">二维码 5 分钟有效，请尽快扫码</p>
        </div>
        <a-button class="mock-btn" size="small" @click="mockConfirm">模拟扫码</a-button>
      </template>
      <template v-else-if="qrcodeStatus === 'confirmed'">
        <div class="status-card">
          <span class="status-icon success">✓</span>
          <p class="status-title">登录成功</p>
          <p class="status-desc">正在跳转...</p>
        </div>
      </template>
      <template v-else-if="qrcodeStatus === 'expired'">
        <div class="status-card">
          <span class="status-icon expired">!</span>
          <p class="status-title">二维码已过期</p>
          <p class="status-desc">请重新获取二维码</p>
          <a-button type="primary" @click="generateQrcode">刷新二维码</a-button>
        </div>
      </template>
    </div>

    <!-- 账号登录 -->
    <div v-if="loginMode === 'account'" class="panel account-panel">
      <a-tabs v-model:activeKey="activeTab" centered size="small">
        <a-tab-pane key="login" tab="登录">
          <a-form :model="loginForm" @finish="handleLogin" layout="vertical" class="login-form">
            <a-form-item name="username" :rules="[{ required: true, message: '请输入用户名' }]">
              <a-input v-model:value="loginForm.username" placeholder="用户名" size="large">
                <template #prefix><UserOutlined /></template>
              </a-input>
            </a-form-item>
            <a-form-item name="password" :rules="[{ required: true, message: '请输入密码' }]">
              <a-input-password v-model:value="loginForm.password" placeholder="密码" size="large">
                <template #prefix><LockOutlined /></template>
              </a-input-password>
            </a-form-item>
            <a-form-item>
              <a-button type="primary" html-type="submit" block size="large" :loading="loading" class="submit-btn">登录</a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>
        <a-tab-pane key="register" tab="注册">
          <a-form :model="registerForm" @finish="handleRegister" layout="vertical" class="login-form">
            <a-form-item name="username" :rules="[{ required: true, message: '请输入用户名' }, { min: 3, message: '用户名至少 3 个字符' }]">
              <a-input v-model:value="registerForm.username" placeholder="用户名" size="large">
                <template #prefix><UserOutlined /></template>
              </a-input>
            </a-form-item>
            <a-form-item name="email" :rules="[{ type: 'email', message: '请输入有效的邮箱地址' }]">
              <a-input v-model:value="registerForm.email" placeholder="邮箱（可选）" size="large" />
            </a-form-item>
            <a-form-item name="password" :rules="[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少 6 个字符' }]">
              <a-input-password v-model:value="registerForm.password" placeholder="密码" size="large">
                <template #prefix><LockOutlined /></template>
              </a-input-password>
            </a-form-item>
            <a-form-item name="confirmPassword" :rules="[{ required: true, message: '请确认密码' }, { validator: validateConfirmPassword }]">
              <a-input-password v-model:value="registerForm.confirmPassword" placeholder="确认密码" size="large">
                <template #prefix><LockOutlined /></template>
              </a-input-password>
            </a-form-item>
            <a-form-item>
              <a-button type="primary" html-type="submit" block size="large" :loading="loading" class="submit-btn">注册</a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import { UserOutlined, LockOutlined, MobileOutlined, WechatOutlined } from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import QRCode from 'qrcode';
import { login, register } from '@/api/auth';
import { createQrcodeTicket, checkQrcodeTicket, mockConfirmScan } from '@/api/qrcode';
import { useUserStore } from '@/stores/user';
import { isWechatBrowser, getWechatOAuthUrl, handleOAuthCallback } from '@/utils/wechat';

const props = defineProps<{ closable?: boolean }>();
const emit = defineEmits<{ (e: 'login-success'): void; (e: 'close'): void }>();

const userStore = useUserStore();

const inWechat = ref(isWechatBrowser());
const activeTab = ref('login');
const loading = ref(false);
const loginMode = ref<'qrcode' | 'oauth' | 'account'>(inWechat.value ? 'oauth' : 'qrcode');

const canvasRef = ref<HTMLCanvasElement>();
const qrcodeStatus = ref<'pending' | 'confirmed' | 'expired'>('pending');
let pollTimer: ReturnType<typeof setInterval> | null = null;
let currentTicket = '';

const loginForm = reactive({ username: '', password: '' });
const registerForm = reactive({ username: '', email: '', password: '', confirmPassword: '' });

const validateConfirmPassword = async (_rule: Rule, value: string) => {
  if (value && value !== registerForm.password) {
    throw new Error('两次输入的密码不一致');
  }
};

onMounted(() => {
  const oauthResult = handleOAuthCallback();
  if (oauthResult) {
    userStore.setToken(oauthResult.accessToken, oauthResult.refreshToken);
    emit('login-success');
    return;
  }
  if (!inWechat.value) generateQrcode();
});
onUnmounted(() => stopPolling());

// 暴露给父组件：关闭时清理
defineExpose({ stopPolling });

async function generateQrcode() {
  qrcodeStatus.value = 'pending';
  currentTicket = '';
  try {
    const { ticketId } = await createQrcodeTicket();
    currentTicket = ticketId;
    await nextTick();
    if (canvasRef.value) {
      await QRCode.toCanvas(canvasRef.value, `https://kedouai.com/mini-scan?ticket=${ticketId}`, {
        width: 220, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' },
      });
    }
    startPolling();
  } catch { qrcodeStatus.value = 'expired'; }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!currentTicket) return;
    try {
      const result = await checkQrcodeTicket(currentTicket);
      qrcodeStatus.value = result.status;
      if (result.status === 'confirmed' && result.accessToken) {
        stopPolling();
        userStore.setToken(result.accessToken, result.refreshToken || '');
        setTimeout(() => emit('login-success'), 1000);
      }
    } catch { /* ignore */ }
  }, 2000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function mockConfirm() {
  if (!currentTicket) return;
  try { await mockConfirmScan(currentTicket); } catch { /* poll will pick up */ }
}

function handleWechatOAuth() {
  window.location.href = getWechatOAuthUrl();
}

const handleLogin = async () => {
  loading.value = true;
  try {
    const res = await login(loginForm);
    userStore.setToken(res.accessToken, res.refreshToken);
    userStore.setUserInfo(res.user);
    message.success('登录成功');
    emit('login-success');
  } catch (error: any) {
    message.error(error?.response?.data?.message || '登录失败');
  } finally { loading.value = false; }
};

const handleRegister = async () => {
  loading.value = true;
  try {
    const res = await register({ username: registerForm.username, password: registerForm.password, email: registerForm.email || undefined });
    userStore.setToken(res.accessToken, res.refreshToken);
    userStore.setUserInfo(res.user);
    message.success('注册成功');
    emit('login-success');
  } catch (error: any) {
    message.error(error?.response?.data?.message || '注册失败');
  } finally { loading.value = false; }
};
</script>

<style scoped>
/* ====== 登录卡片 ====== */
.login-card {
  width: 420px;
  padding: 36px 32px 32px;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 18px;
  box-shadow:
    0 4px 6px rgba(0, 0, 0, 0.12),
    0 20px 60px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  position: relative;
  z-index: 1;
  backdrop-filter: blur(10px);
}

/* ====== 关闭按钮（弹窗模式） ====== */
.card-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.06);
  color: #999;
  font-size: 15px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 2;
  line-height: 1;
}
.card-close:hover {
  background: rgba(0, 0, 0, 0.12);
  color: #333;
}

/* ====== 品牌区 ====== */
.brand-section { text-align: center; margin-bottom: 24px; }
.brand-icon {
  display: inline-flex; width: 52px; height: 52px;
  align-items: center; justify-content: center; margin-bottom: 10px;
  background: transparent;
  border-radius: 12px;
}
.brand-logo {
  border-radius: 12px;
}
.brand-name {
  font-size: 24px; font-weight: 700; color: #1a1a2e;
  margin: 0 0 4px 0; letter-spacing: 4px;
}
.brand-desc {
  font-size: 13px; color: #999; margin: 0; letter-spacing: 2px;
}

/* ====== 登录方式切换 ====== */
.login-tabs {
  display: flex; gap: 10px; margin-bottom: 24px; padding: 0 2px;
}
.tab-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 0; border: 2px solid #f0f0f0; border-radius: 12px;
  background: #fafafa; color: #666; font-size: 14px; font-weight: 500;
  cursor: pointer; transition: all 0.25s ease; outline: none; font-family: inherit;
}
.tab-btn:hover { border-color: #fed7aa; background: #fff7ed; }
.tab-btn.active {
  background: #f97316;
  border-color: transparent; color: #fff;
  box-shadow: 0 4px 14px rgba(249, 115, 22, 0.25);
}

/* ====== 面板容器 ====== */
.panel { min-height: 220px; }

/* ====== 扫码面板 ====== */
.qrcode-panel { display: flex; flex-direction: column; align-items: center; }
.qrcode-frame {
  padding: 12px; background: #fff; border-radius: 14px; line-height: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06), inset 0 0 0 4px rgba(249,115,22,0.08);
}
.qrcode-canvas { border-radius: 8px; display: block; }
.qrcode-info { text-align: center; margin-top: 14px; }
.qrcode-tip { font-size: 15px; color: #333; font-weight: 600; margin: 0; }
.qrcode-expire { font-size: 12px; color: #bbb; margin: 4px 0 0 0; }

/* ====== 状态卡片 ====== */
.status-card { display: flex; flex-direction: column; align-items: center; padding: 20px 0; gap: 8px; }
.status-icon {
  width: 56px; height: 56px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; font-weight: 700;
}
.status-icon.success { background: #f6ffed; color: #52c41a; }
.status-icon.expired { background: #fff7e6; color: #faad14; }
.status-title { font-size: 17px; font-weight: 600; color: #333; margin: 0; }
.status-desc { font-size: 13px; color: #999; margin: 0 0 4px 0; }

/* ====== 微信 OAuth 按钮面板 ====== */
.oauth-panel { display: flex; flex-direction: column; align-items: center; padding: 10px 0 8px; }
.oauth-wechat-icon {
  width: 60px; height: 60px; border-radius: 50%;
  background: #07c160;
  display: flex; align-items: center; justify-content: center;
  font-size: 34px; color: #fff;
  box-shadow: 0 4px 16px rgba(7,193,96,0.35); margin-bottom: 14px;
}
.oauth-title { font-size: 18px; font-weight: 600; color: #1a1a2e; margin: 0 0 6px 0; }
.oauth-desc { font-size: 13px; color: #999; margin: 0 0 22px 0; text-align: center; line-height: 1.5; }
.oauth-btn {
  height: 46px; border-radius: 12px; font-size: 16px; font-weight: 600;
  background: #07c160 !important; border-color: #07c160 !important; color: #fff !important;
  box-shadow: 0 4px 16px rgba(7,193,96,0.35); transition: all 0.3s;
}
.oauth-btn:hover {
  background: #06ad56 !important; border-color: #06ad56 !important;
  box-shadow: 0 6px 20px rgba(7,193,96,0.5) !important;
}
.oauth-btn :deep(.anticon) { color: #fff !important; }

/* ====== 模拟按钮 ====== */
.mock-btn {
  margin-top: 18px; font-size: 12px; color: #ccc;
  border-color: #f0f0f0; background: transparent; transition: all 0.2s;
}
.mock-btn:hover { color: #999 !important; border-color: #ddd !important; }

/* ====== 账号登录面板 ====== */
.account-panel { padding: 0 2px; }
.login-form { margin-top: 4px; }
.submit-btn {
  height: 44px; border-radius: 12px; font-size: 16px; font-weight: 600;
  background: #f97316 !important;
  border: none !important; box-shadow: 0 4px 14px rgba(249,115,22,0.3);
  transition: box-shadow 0.3s;
}
.submit-btn:hover { box-shadow: 0 6px 20px rgba(249,115,22,0.45) !important; }

.login-form :deep(.ant-form-item) { margin-bottom: 16px; }
.login-form :deep(.ant-form-item:last-child) { margin-bottom: 0; }
.login-form :deep(.ant-tabs-nav) { margin-bottom: 16px !important; }
.login-card :deep(.ant-input-affix-wrapper),
.login-card :deep(.ant-input) { border-radius: 8px !important; }
.login-card :deep(.ant-tabs-tab) { border-radius: 6px !important; }
.login-card :deep(.ant-btn) { border-radius: 8px; }
</style>
