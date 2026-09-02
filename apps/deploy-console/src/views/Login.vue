<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { UserOutlined, LockOutlined } from '@ant-design/icons-vue'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const loading = ref(false)

const formState = reactive({
  username: '',
  password: '',
})

// 登录提交
async function handleLogin() {
  if (!formState.username || !formState.password) {
    message.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  try {
    await authStore.login(formState.username, formState.password)
    message.success('登录成功')
    const redirect = (route.query.redirect as string) || '/dashboard'
    router.push(redirect)
  } catch (err: any) {
    message.error(err.response?.data?.message || '登录失败，请检查用户名和密码')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-container">
    <!-- 背景蜂巢装饰：嵌套六边形，弱化呈现 -->
    <svg
      class="login-hive"
      viewBox="0 0 360 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M0 190 L75 60 L225 60 L300 190 L225 320 L75 320 Z"
        stroke="#F5A623"
        stroke-width="2"
        stroke-linejoin="round"
        opacity="0.28"
      />
      <path
        d="M55 190 L102.5 107.7 L197.5 107.7 L245 190 L197.5 272.3 L102.5 272.3 Z"
        stroke="#F5A623"
        stroke-width="1.5"
        stroke-linejoin="round"
        opacity="0.18"
      />
      <path
        d="M105 190 L127.5 151 L172.5 151 L195 190 L172.5 229 L127.5 229 Z"
        fill="#F5A623"
        opacity="0.35"
      />
    </svg>
    <div class="login-card">
      <img class="login-logo" src="/console/favicon.svg" alt="Beehive" />
      <h1>Beehive</h1>
      <p class="login-subtitle">自运转的智能研发蜂巢</p>
      <a-form
        :model="formState"
        layout="vertical"
        @finish="handleLogin"
      >
        <a-form-item name="username">
          <a-input
            v-model:value="formState.username"
            size="large"
            placeholder="请输入用户名"
            @pressEnter="handleLogin"
          >
            <template #prefix><UserOutlined /></template>
          </a-input>
        </a-form-item>

        <a-form-item name="password">
          <a-input-password
            v-model:value="formState.password"
            size="large"
            placeholder="请输入密码"
            @pressEnter="handleLogin"
          >
            <template #prefix><LockOutlined /></template>
          </a-input-password>
        </a-form-item>

        <a-form-item>
          <a-button
            type="primary"
            size="large"
            block
            :loading="loading"
            @click="handleLogin"
          >
            登 录
          </a-button>
        </a-form-item>
      </a-form>
    </div>
  </div>
</template>
