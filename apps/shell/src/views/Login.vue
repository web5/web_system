<template>
  <div class="shell-login">
    <a-card title="登录" class="login-card">
      <a-form layout="vertical" :model="form" :rules="rules" ref="formRef" @finish="onLogin">
        <a-form-item label="用户名" name="username">
          <a-input v-model:value="form.username" placeholder="用户名" />
        </a-form-item>
        <a-form-item label="密码" name="password">
          <a-input-password v-model:value="form.password" placeholder="密码" @keyup.enter="onLogin" />
        </a-form-item>
        <a-button type="primary" :loading="loading" block @click="onLogin">登录</a-button>
      </a-form>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';
import { saveAuth } from '../auth-storage';

const router = useRouter();
const loading = ref(false);
const formRef = ref();
const form = reactive({ username: '', password: '' });
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function onLogin() {
  // 先手动校验（a-form 的 :model/:rules 校验有时不触发，改用 try 手动校验）
  if (!form.username || !form.password) {
    alert('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    const res: any = await axios.post('/api/auth/login', form);
    // axios 响应对象：实际数据在 res.data；auth-service 返回 { accessToken, refreshToken, user }
    const data = res?.data || res || {};
    console.log('[login] response:', data);
    const token = data?.accessToken || data?.token;
    if (!token) {
      alert('登录失败：未返回 token');
      return;
    }
    // 统一写两套存储：基座（token/refreshToken/user）+ 模块（user-store）
    saveAuth(token, data.refreshToken || '', data.user || { username: form.username });
    const redirect = (router.currentRoute.value.query.redirect as string) || '/';
    console.log('[login] redirect to:', redirect);
    // 用 location.href 兜底：避免 vue-router push 失败导致页面卡在 login
    window.location.href = redirect.startsWith('/') ? redirect : `/${redirect}`;
  } catch (e: any) {
    console.error('[login] error:', e);
    const msg = e?.response?.data?.message || e?.message || '登录失败';
    alert(msg);
  } finally {
    loading.value = false;
  }
}
</script>

<style>
.shell-login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ws-bg-page);
}
.login-card { width: 360px; }
</style>
