<template>
  <div class="user-detail-page">
    <div class="page-header">
      <a-space>
        <a-button @click="goBack">← 返回</a-button>
        <h1>用户详情</h1>
      </a-space>
    </div>

    <a-card v-if="user" :loading="loading">
      <a-descriptions title="基本信息" :column="2" bordered>
        <a-descriptions-item label="用户 ID">{{ user.id }}</a-descriptions-item>
        <a-descriptions-item label="用户名">{{ user.username }}</a-descriptions-item>
        <a-descriptions-item label="昵称">{{ user.nickname || '-' }}</a-descriptions-item>
        <a-descriptions-item label="邮箱">{{ user.email || '-' }}</a-descriptions-item>
        <a-descriptions-item label="手机号">{{ user.phone || '-' }}</a-descriptions-item>
        <a-descriptions-item label="角色">
          <a-tag :color="user.role === 'admin' ? 'red' : 'blue'">
            {{ user.role === 'admin' ? '管理员' : '普通用户' }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="user.enabled ? 'green' : 'red'">
            {{ user.enabled ? '启用' : '禁用' }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">{{ user.createdAt }}</a-descriptions-item>
        <a-descriptions-item label="更新时间">{{ user.updatedAt }}</a-descriptions-item>
      </a-descriptions>

      <a-divider />

      <a-descriptions title="头像信息" :column="1" bordered>
        <a-descriptions-item label="头像">
          <a-avatar :size="100" :src="user.avatar" v-if="user.avatar" />
          <span v-else>未设置头像</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';

interface User {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatar?: string;
  role: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

const route = useRoute();
const loading = ref(false);
const user = ref<User | null>(null);

onMounted(() => {
  fetchUserDetail();
});

async function fetchUserDetail() {
  loading.value = true;
  try {
    const userId = route.params.id as string;
    // TODO: 调用实际 API
    // const res = await userApi.getDetail(userId);
    // user.value = res;
    
    // 模拟数据
    user.value = {
      id: userId,
      username: 'testuser',
      email: 'test@example.com',
      phone: '13800138000',
      nickname: '测试用户',
      avatar: '',
      role: 'user',
      enabled: true,
      createdAt: '2024-01-01 10:00:00',
      updatedAt: '2024-01-01 10:00:00',
    };
  } catch (error) {
    message.error('获取用户详情失败');
  } finally {
    loading.value = false;
  }
}

function goBack() {
  window.history.back();
}
</script>

<style scoped>
.user-detail-page {
  padding: 24px;
}

.page-header {
  margin-bottom: 24px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
  display: inline;
}
</style>
