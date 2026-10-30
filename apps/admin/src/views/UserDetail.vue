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
          <a-tag :color="roleTagColor(displayRole)">
            {{ roleLabel(displayRole) }}
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

      <!-- 用户记忆（#8229 批次 2 卡 2.2）：🔴 只读——无删除/重建/编辑任何写入口 -->
      <div class="section">
        <h3 class="mem-head">
          用户记忆
          <a-tag class="mem-ro-badge">只读</a-tag>
          <span class="mem-head-desc">AI 在对话中自动提炼的用户信息，供运营查看</span>
        </h3>

        <!-- 摘要卡：独立 skeleton / empty / error+重试，与明细互不阻塞 -->
        <div class="mem-summary">
          <a-skeleton v-if="memSummaryLoading" active :title="{ width: '30%' }" :paragraph="{ rows: 3 }" />
          <div v-else-if="memSummaryError" class="mem-state">
            <p class="mem-state-text">记忆摘要加载失败</p>
            <a-button size="small" @click="fetchMemorySummary">重试</a-button>
          </div>
          <!-- 空态：只有说明，无任何按钮（只读口径，不提供生成入口） -->
          <div v-else-if="!memSummary" class="mem-state">
            <p class="mem-state-text">暂无记忆摘要</p>
            <p class="mem-state-hint">用户完成一次对话后自动生成；admin 端只读，不提供生成入口</p>
          </div>
          <template v-else>
            <div class="mem-summary-hd">
              <span class="mem-summary-title">记忆摘要</span>
              <a-tag v-if="memPending" color="orange">待更新</a-tag>
              <span class="mem-summary-sp"></span>
              <a-button size="small" type="text" @click="copySummary">复制</a-button>
            </div>
            <!-- 摘要正文来自 LLM 提炼（半可信输入）：{{ }} 插值转义渲染，禁 v-html -->
            <div class="mem-summary-body">{{ memSummary.summary }}</div>
            <div class="mem-meta">
              <span>条数 <span class="mem-num">{{ memSummary.itemCount }}</span></span>
              <span class="mem-meta-dot">·</span>
              <span>版本 <span class="mem-num">v{{ memSummary.version }}</span></span>
              <span class="mem-meta-dot">·</span>
              <span>更新时间 <span class="mem-num">{{ formatDateTime(memSummary.updatedAt) }}</span></span>
              <template v-if="memPending">
                <span class="mem-meta-dot">·</span>
                <span class="mem-pending-note">用户改过明细，摘要在下次对话后刷新</span>
              </template>
            </div>
          </template>
        </div>

        <!-- 明细（只读，无操作列）：独立 skeleton / empty / error+重试 -->
        <div class="mem-detail">
          <div class="mem-detail-hd" @click="memDetailOpen = !memDetailOpen">
            <span class="mem-detail-caret" :class="{ open: memDetailOpen }">▶</span>
            <span class="mem-detail-title">明细（{{ memTotal }}）</span>
            <span class="mem-detail-desc">给人看的审计记录；admin 端只读，不支持删除或编辑</span>
          </div>
          <div v-show="memDetailOpen" class="mem-detail-body">
            <a-skeleton v-if="memDetailLoading" active :title="{ width: '22%' }" :paragraph="{ rows: 3 }" />
            <div v-else-if="memDetailError" class="mem-state">
              <p class="mem-state-text">明细加载失败（与摘要互不影响）</p>
              <a-button size="small" @click="fetchMemDetail">重试</a-button>
            </div>
            <a-empty v-else-if="memList.length === 0" description="暂无明细记录" />
            <a-table
              v-else
              :columns="memColumns"
              :data-source="memList"
              :pagination="memPagination"
              row-key="id"
              size="small"
              @change="onMemTableChange"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'category'">
                  <a-tag :color="memCategoryColor(record.category)">
                    {{ memCategoryLabel(record.category) }}
                  </a-tag>
                </template>
                <template v-else-if="column.key === 'content'">
                  <span :title="record.content">{{ record.content }}</span>
                </template>
                <template v-else-if="column.key === 'confidence'">
                  <span class="mem-num">{{ Number(record.confidence).toFixed(2) }}</span>
                </template>
                <template v-else-if="column.key === 'createdAt'">
                  <span class="mem-num">{{ formatDateTime(record.createdAt) }}</span>
                </template>
              </template>
            </a-table>
          </div>
        </div>
      </div>

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
import type { TableProps } from 'ant-design-vue';
import { userApi, getUserMemory, type UserMemoryItem, type UserMemorySummary } from '@/api/user';
import { artworksApi, type ArtworkItem, type ArtworkSourceType } from '@/api/artworks';
import { pickRole, roleLabel, roleTagColor } from '@/utils/roles';

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

/* ===== 用户记忆（只读面板，#8229 批次 2 卡 2.2） ===== */
const MEM_PAGE_SIZE = 10;

const memSummary = ref<UserMemorySummary | null>(null);
const memSummaryLoading = ref(false);
const memSummaryError = ref(false);

const memList = ref<UserMemoryItem[]>([]);
const memTotal = ref(0);
const memPage = ref(1);
const memDetailLoading = ref(false);
const memDetailError = ref(false);
const memDetailOpen = ref(true);

/** 摘要覆盖条数 ≠ 明细总数 → 明细有增删而摘要尚未跟上，标「待更新」 */
const memPending = computed(
  () => !!memSummary.value && Number(memSummary.value.itemCount) !== memTotal.value,
);

const memColumns = [
  { title: '分类', key: 'category', width: 92 },
  { title: '内容', key: 'content', ellipsis: true },
  { title: '置信度', key: 'confidence', width: 96, align: 'right' as const },
  { title: '更新时间', key: 'createdAt', width: 160 },
];

const memPagination = computed(() => ({
  current: memPage.value,
  pageSize: MEM_PAGE_SIZE,
  total: memTotal.value,
  showSizeChanger: false,
  showTotal: (t: number) => `共 ${t} 条`,
}));

function memCategoryLabel(category: string): string {
  const map: Record<string, string> = { fact: '事实', preference: '偏好', habit: '习惯' };
  return map[category] ?? category;
}

function memCategoryColor(category: string): string {
  // page-spec §表格列清单：fact=蓝 / preference=紫 / habit=绿
  const map: Record<string, string> = { fact: 'blue', preference: 'purple', habit: 'green' };
  return map[category] ?? 'default';
}

async function fetchMemorySummary() {
  memSummaryLoading.value = true;
  memSummaryError.value = false;
  try {
    const res = await getUserMemory(route.params.id as string, memPage.value, MEM_PAGE_SIZE);
    memSummary.value = res?.summary ?? null;
  } catch {
    memSummaryError.value = true;
  } finally {
    memSummaryLoading.value = false;
  }
}

async function fetchMemDetail() {
  memDetailLoading.value = true;
  memDetailError.value = false;
  try {
    const res = await getUserMemory(route.params.id as string, memPage.value, MEM_PAGE_SIZE);
    memList.value = res?.memories?.list ?? [];
    memTotal.value = res?.memories?.total ?? 0;
  } catch {
    memDetailError.value = true;
  } finally {
    memDetailLoading.value = false;
  }
}

function onMemTableChange(pag: { current?: number }) {
  memPage.value = pag.current ?? 1;
  void fetchMemDetail();
}

/** 复制摘要（读操作）：优先 navigator.clipboard，失败给提示 */
async function copySummary() {
  const text = memSummary.value?.summary ?? '';
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    message.success('已复制');
  } catch {
    message.error('复制失败');
  }
}

function formatDateTime(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const avatarSrc = computed(() => {
  const u = user.value;
  if (u?.avatar) return u.avatar;
  return u?.gender === 'female'
    ? `${__PUBLIC_ASSET_BASE__}avatars/default-female.png`
    : `${__PUBLIC_ASSET_BASE__}avatars/default-male.png`;
});

/** 后端返回 roles 数组；兼容老字段 role 单值。super_admin 等内置角色由 utils/roles 统一展示 */
const displayRole = computed(() => {
  const u = user.value as any;
  const roles = Array.isArray(u?.roles) ? u.roles : (u?.role ? [u.role] : []);
  return pickRole(roles);
});

watch(user, (val) => {
  if (val) {
    quotaValue.value = val.dailyTransformLimit ?? null;
  }
});

onMounted(() => {
  fetchUserDetail();
  void fetchMemorySummary();
  void fetchMemDetail();
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

/* ===== 用户记忆（只读面板） ===== */
.mem-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mem-ro-badge {
  background: var(--ws-bg-subtle, #f2f2f2);
  color: var(--ws-text-secondary, #525252);
}

.mem-head-desc {
  font-size: 12px;
  font-weight: 400;
  color: #999;
}

.mem-summary {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  background: #fafafa;
  padding: 14px 16px;
  margin-bottom: 14px;
}

.mem-summary-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.mem-summary-title {
  font-size: 13px;
  font-weight: 600;
  color: #171717;
}

.mem-summary-sp {
  flex: 1;
}

.mem-summary-body {
  font-size: 13px;
  color: #3f3f46;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}

.mem-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 12px;
  color: #525252;
}

.mem-meta-dot {
  color: #a3a3a3;
}

.mem-num {
  font-variant-numeric: tabular-nums;
}

.mem-pending-note {
  color: #c2410c;
}

.mem-detail {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  overflow: hidden;
}

.mem-detail-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  cursor: pointer;
  user-select: none;
  background: #fff;
}

.mem-detail-hd:hover {
  background: #f2f2f2;
}

.mem-detail-caret {
  font-size: 10px;
  color: #a3a3a3;
  transition: transform 0.15s ease-out;
}

.mem-detail-caret.open {
  transform: rotate(90deg);
}

.mem-detail-title {
  font-size: 13px;
  font-weight: 600;
  color: #171717;
}

.mem-detail-desc {
  font-size: 12px;
  color: #999;
}

.mem-detail-body {
  border-top: 1px solid #ebebeb;
  padding: 12px 16px;
}

.mem-state {
  padding: 20px 16px;
  text-align: center;
}

.mem-state-text {
  font-size: 13px;
  color: #525252;
  margin-bottom: 8px;
}

.mem-state-hint {
  font-size: 12px;
  color: #a3a3a3;
  margin: 0;
}

.artworks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.artwork-card {
  border-radius: var(--r-card);
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
