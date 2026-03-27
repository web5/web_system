<template>
  <div class="login-container">
    <div class="login-box">
      <h1 class="login-title">管理后台</h1>
      <a-tabs v-model:activeKey="activeTab">
        <a-tab-pane key="login" tab="登录">
          <a-form :model="loginForm" @finish="handleLogin" layout="vertical">
            <a-form-item
              name="username"
              :rules="[{ required: true, message: '请输入用户名' }]"
            >
              <a-input
                v-model:value="loginForm.username"
                placeholder="用户名"
                size="large"
                :prefix="h(UserOutlined)"
              />
            </a-form-item>
            <a-form-item
              name="password"
              :rules="[{ required: true, message: '请输入密码' }]"
            >
              <a-input-password
                v-model:value="loginForm.password"
                placeholder="密码"
                size="large"
                :prefix="h(LockOutlined)"
              />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" html-type="submit" block size="large" :loading="loading">
                登录
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>
        <a-tab-pane key="register" tab="注册">
          <a-form :model="registerForm" @finish="handleRegister" layout="vertical">
            <a-form-item
              name="username"
              :rules="[
                { required: true, message: '请输入用户名' },
                { min: 3, message: '用户名至少 3 个字符' }
              ]"
            >
              <a-input
                v-model:value="registerForm.username"
                placeholder="用户名"
                size="large"
                :prefix="h(UserOutlined)"
              />
            </a-form-item>
            <a-form-item
              name="email"
              :rules="[
                { type: 'email', message: '请输入有效的邮箱地址' }
              ]"
            >
              <a-input
                v-model:value="registerForm.email"
                placeholder="邮箱（可选）"
                size="large"
              />
            </a-form-item>
            <a-form-item
              name="password"
              :rules="[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少 6 个字符' }
              ]"
            >
              <a-input-password
                v-model:value="registerForm.password"
                placeholder="密码"
                size="large"
                :prefix="h(LockOutlined)"
              />
            </a-form-item>
            <a-form-item
              name="confirmPassword"
              :rules="[
                { required: true, message: '请确认密码' },
                { validator: validateConfirmPassword }
              ]"
            >
              <a-input-password
                v-model:value="registerForm.confirmPassword"
                placeholder="确认密码"
                size="large"
                :prefix="h(LockOutlined)"
              />
            </a-form-item>
            <a-form-item>
              <a-button type="primary" html-type="submit" block size="large" :loading="loading">
                注册
              </a-button>
            </a-form-item>
          </a-form>
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, h } from 'vue';
import { useRouter } from 'vue-router';
import { UserOutlined, LockOutlined } from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';
import type { Rule } from 'ant-design-vue/es/form';
import { login, register } from '@/api/auth';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

const activeTab = ref('login');
const loading = ref(false);

const loginForm = reactive({
  username: '',
  password: '',
});

const registerForm = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
});

const validateConfirmPassword = async (_rule: Rule, value: string) => {
  if (value && value !== registerForm.password) {
    throw new Error('两次输入的密码不一致');
  }
};

const handleLogin = async () => {
  loading.value = true;
  try {
    const res = await login(loginForm);
    userStore.setToken(res.accessToken, res.refreshToken);
    userStore.setUserInfo(res.user);
    message.success('登录成功');
    router.push('/');
  } catch (error: any) {
    message.error(error?.response?.data?.message || '登录失败');
  } finally {
    loading.value = false;
  }
};

const handleRegister = async () => {
  loading.value = true;
  try {
    const res = await register({
      username: registerForm.username,
      password: registerForm.password,
      email: registerForm.email || undefined,
    });
    userStore.setToken(res.accessToken, res.refreshToken);
    userStore.setUserInfo(res.user);
    message.success('注册成功');
    router.push('/');
  } catch (error: any) {
    message.error(error?.response?.data?.message || '注册失败');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-box {
  width: 400px;
  padding: 40px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.login-title {
  text-align: center;
  margin-bottom: 30px;
  color: #333;
  font-size: 28px;
}

.wechat-login {
  text-align: center;
  padding: 20px 0;
}

.qrcode-box {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.qrcode {
  width: 200px;
  height: 200px;
  margin-bottom: 10px;
}

.qrcode-tip {
  color: #666;
  font-size: 14px;
}
</style>
