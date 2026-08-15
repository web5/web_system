import { defineStore } from 'pinia'
import { authApi } from '@/api'

interface User {
  username: string
  role: string
}

interface AuthState {
  token: string
  user: User | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: '',
    user: null,
  }),
  actions: {
    // 登录
    async login(username: string, password: string) {
      const res = await authApi.login(username, password)
      this.token = res.token
      this.user = res.user
    },
    // 获取用户信息
    async fetchProfile() {
      try {
        const res = await authApi.profile()
        this.user = res
      } catch {
        this.logout()
      }
    },
    // 退出
    logout() {
      this.token = ''
      this.user = null
    },
  },
  persist: true,
})
