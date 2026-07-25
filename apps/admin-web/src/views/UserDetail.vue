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

      <div class="section">
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
        <p class="hint-text">
          {{ quotaValue === null ? '当前使用全局默认限制' : `当前个人限额：每天 ${quotaValue} 次` }}
        </p>
      </div>

      <a-divider />

      <div class="section">
        <h3>
          用户作品
          <a-tag v-if="artworks.length > 0" style="margin-left: 8px;">{{ artworks.length }}</a-tag>
        </h3>
        <a-spin :spinning="artworksLoading">
          <a-empty v-if="!artworksLoading && artworks.length === 0" description="暂无作品" />
          <div v-else class="artworks-grid">
            <a-card
              v-for="item in artworks"
              :key="item.id"
              hoverable
              class="artwork-card"
            >
              <template #cover>
                <div class="artwork-image-wrapper">
                  <img
                    v-if="item.imageUrl"
                    :src="item.imageUrl"
                    :alt="item.title"
                    class="artwork-image"
                    @error="onImageError"
                  />
                  <div v-else class="artwork-image-placeholder">
                    <span>暂无图片</span>
                  </div>
                </div>
              </template>
              <a-card-meta>
                <template #title>
                  <span class="artwork-title">{{ item.title || '未命名作品' }}</span>
                </template>
                <template #description>
                  <div class="artwork-meta">
                    <a-tag :color="sourceColorMap[item.sourceType] || 'default'" size="small">
                      {{ sourceLabelMap[item.sourceType] || item.sourceType }}
                    </a-tag>
                    <span class="artwork-date">{{ formatDate(item.createdAt) }}</span>
                  </div>
                </template>
              </a-card-meta>
            </a-card>
          </div>
        </a-spin>
      </div>
    </a-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { message } from 'ant-design-vue';
import { userApi } from '@/api/user';
import { artworksApi, type ArtworkItem, type ArtworkSourceType } from '@/api/artworks';

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

const sourceLabelMap: Record<ArtworkSourceType, string> = {
  bianbian: '变变变身',
  'draw-ai': 'AI 画板',
  design: '设计作品',
  'ai-art': 'AI 艺术',
};

const sourceColorMap: Record<ArtworkSourceType, string> = {
  bianbian: 'orange',
  'draw-ai': 'blue',
  design: 'purple',
  'ai-art': 'green',
};

const route = useRoute();
const loading = ref(false);
const user = ref<User | null>(null);
const quotaValue = ref<number | null>(null);
const quotaSaving = ref(false);

const artworks = ref<ArtworkItem[]>([]);
const artworksLoading = ref(false);

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
    // 用户信息加载成功后，加载作品列表
    if (res?.id) {
      fetchArtworks(Number(res.id));
    }
  } catch (error) {
    message.error('获取用户详情失败');
  } finally {
    loading.value = false;
  }
}

async function fetchArtworks(userId: number) {
  artworksLoading.value = true;
  try {
    const res = await artworksApi.getByUser(userId);
    artworks.value = res?.data ?? [];
  } catch {
    // 静默失败，不影响其他信息展示
    artworks.value = [];
  } finally {
    artworksLoading.value = false;
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function onImageError(e: Event) {
  const target = e.target as HTMLImageElement;
  target.style.display = 'none';
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

.section {
  margin-top: 8px;
}

.section h3 {
  margin-bottom: 16px;
  font-size: 16px;
}

.hint-text {
  margin-top: 12px;
  color: #888;
  font-size: 13px;
}

.artworks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.artwork-card {
  border-radius: 12px;
  overflow: hidden;
}

.artwork-card :deep(.ant-card-cover) {
  overflow: hidden;
}

.artwork-image-wrapper {
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background: #f5f5f5;
}

.artwork-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.artwork-card:hover .artwork-image {
  transform: scale(1.05);
}

.artwork-image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bbb;
  font-size: 14px;
  background: #fafafa;
}

.artwork-title {
  font-size: 14px;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artwork-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.artwork-date {
  font-size: 12px;
  color: #999;
  white-space: nowrap;
}
</style>
