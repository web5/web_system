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
          <a-avatar :size="100" :src="avatarSrc" />
        </a-descriptions-item>
      </a-descriptions>

      <a-divider />

      <div class="quota-section">
        <h3>变变使用配额</h3>
        <a-form layout="inline" @finish="saveQuota">
          <a-form-item label="每日变身次数">
            <a-input-number
              v-model:value="quotaValue"
              :min="0"
              placeholder="留空=使用全局默认"
              style="width: 220px"
            />
          </a-form-item>
          <a-form-item>
            <a-space>
              <a-button type="primary" html-type="submit" :loading="quotaSaving">保存</a-button>
              <a-button @click="resetQuota">重置为全局默认</a-button>
            </a-space>
          </a-form-item>
        </a-form>
        <p class="quota-hint">
          {{ quotaValue === null ? '当前使用全局默认限制' : `当前个人限额：每天 ${quotaValue} 次` }}
        </p>
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import { userApi } from '@/api/user';

type User = {
  id: string | number;
  username: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatar?: string;
  gender?: 'male' | 'female' | 'unknown';
  role?: string;
  enabled?: boolean;
  dailyTransformLimit?: number | null;
  createdAt?: string;
  updatedAt?: string;
};

const route = useRoute();
const loading = ref(false);
const user = ref<User | null>(null);
const quotaValue = ref<number | null>(null);
const quotaSaving = ref(false);

const avatarSrc = computed(() => {
  const u = user.value;
  if (u?.avatar) return u.avatar;
  return u?.gender === 'female' ? '/avatars/default-female.png' : '/avatars/default-male.png';
});

watch(user, (val) => {
  if (val) {
    quotaValue.value = val.dailyTransformLimit ?? null;
  }
});

onMounted(() => {
  fetchUserDetail();
});

async function fetchUserDetail() {
  loading.value = true;
  try {
    const userId = route.params.id as string;
    const res = await userApi.getDetail(userId);
    user.value = res;
  } catch (error) {
    message.error('获取用户详情失败');
  } finally {
    loading.value = false;
  }
}

async function saveQuota() {
  quotaSaving.value = true;
  try {
    const userId = route.params.id as string;
    await userApi.update(userId, { dailyTransformLimit: quotaValue.value });
    if (user.value) {
      user.value.dailyTransformLimit = quotaValue.value;
    }
    message.success('配额保存成功');
  } catch (error) {
    message.error('保存失败');
  } finally {
    quotaSaving.value = false;
  }
}

function resetQuota() {
  quotaValue.value = null;
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

.quota-section {
  margin-top: 8px;
}

.quota-section h3 {
  margin-bottom: 16px;
  font-size: 16px;
}

.quota-hint {
  margin-top: 12px;
  color: #888;
  font-size: 13px;
}
</style>
