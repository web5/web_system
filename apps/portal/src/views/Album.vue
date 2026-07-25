<template>
  <div class="album-page">
    <div class="album-header">
      <button class="back-btn" @click="$router.back()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <h1 class="page-title">我的相册</h1>
      <div class="header-spacer"></div>
    </div>

    <!-- Tab 切换 -->
    <div class="album-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        <svg v-if="tab.key === 'design'" class="tab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
        <svg v-else class="tab-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><line x1="12" y1="22" x2="12" y2="15.5"/><polyline points="22 8.5 12 15.5 2 8.5"/></svg>
        {{ tab.label }}
        <span class="tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <div class="album-container">
      <!-- 加载中 -->
      <div v-if="loading" class="album-placeholder">
        <div class="spinner"></div>
        <p>加载中...</p>
      </div>

      <!-- 空状态 -->
      <div v-else-if="filteredList.length === 0" class="album-placeholder">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        <p>{{ activeTab === 'design' ? '还没有设计作品' : '还没有AI作品' }}</p>
        <p class="sub-tip">{{ activeTab === 'design' ? '在画板或变变中保存的原画会出现在这里' : '在画板或变变中生成的AI作品会出现在这里' }}</p>
        <button class="go-create-btn" @click="$router.push(activeTab === 'design' ? '/draw' : '/create')">去创作</button>
      </div>

      <!-- 作品网格 -->
      <div v-else class="album-grid">
        <div
          v-for="item in filteredList"
          :key="item.id"
          class="album-item"
          @click="openPreview(item)"
        >
          <img :src="item.imageUrl" :alt="item.title" class="album-thumb" />
          <div class="item-overlay">
            <span class="item-source">{{ sourceLabel(item.sourceType) }}</span>
            <button class="item-delete" @click.stop="handleDelete(item)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
          <p class="item-title">{{ item.title }}</p>
        </div>
      </div>
    </div>

    <!-- 大图预览 -->
    <Teleport to="body">
      <div v-if="previewItem" class="preview-mask" @click="closePreview">
        <div class="preview-card" @click.stop>
          <button class="preview-close" @click="closePreview">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <img :src="previewItem.imageUrl" :alt="previewItem.title" class="preview-img" />
          <div class="preview-info">
            <h3>{{ previewItem.title }}</h3>
            <p class="preview-source">{{ sourceLabel(previewItem.sourceType) }}</p>
            <div class="preview-actions">
              <button class="preview-btn" @click="downloadItem(previewItem)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                下载
              </button>
              <button class="preview-btn danger" @click="handleDelete(previewItem); closePreview()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                删除
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import { getArtworks, deleteArtwork, type ArtworkItem, type ArtworkSourceType } from '@/api/artworks';

const userStore = useUserStore();
const loading = ref(true);
const list = ref<ArtworkItem[]>([]);
const previewItem = ref<ArtworkItem | null>(null);
const activeTab = ref<'design' | 'ai-art'>('design');

const sourceLabels: Record<ArtworkSourceType, string> = {
  bianbian: '变变',
  'draw-ai': '画板',
  design: '设计',
  'ai-art': 'AI',
};

function sourceLabel(type: ArtworkSourceType): string {
  return sourceLabels[type] || type;
}

/** AI 类型：新 'ai-art' + 历史 'bianbian' / 'draw-ai' */
const AI_SOURCE_TYPES: ArtworkSourceType[] = ['ai-art', 'bianbian', 'draw-ai'];

const filteredList = computed(() => {
  if (activeTab.value === 'design') {
    return list.value.filter(item => item.sourceType === 'design');
  }
  return list.value.filter(item => AI_SOURCE_TYPES.includes(item.sourceType));
});

const tabs = computed(() => [
  {
    key: 'design' as const,
    label: '设计作品',
    count: list.value.filter(item => item.sourceType === 'design').length,
  },
  {
    key: 'ai-art' as const,
    label: 'AI 作品',
    count: list.value.filter(item => AI_SOURCE_TYPES.includes(item.sourceType)).length,
  },
]);

async function loadList() {
  const userId = userStore.userInfo?.id;
  if (!userId) {
    loading.value = false;
    return;
  }
  try {
    const res = await getArtworks(userId);
    if (res.code === 0) {
      list.value = res.data || [];
    } else {
      message.error(res.message || '加载失败');
    }
  } catch {
    message.error('加载失败');
  } finally {
    loading.value = false;
  }
}

async function handleDelete(item: ArtworkItem) {
  const userId = userStore.userInfo?.id;
  if (!userId) return;
  try {
    const res = await deleteArtwork(item.id, userId);
    if (res.code === 0) {
      list.value = list.value.filter(i => i.id !== item.id);
      message.success('已删除');
    } else {
      message.error(res.message || '删除失败');
    }
  } catch {
    message.error('删除失败');
  }
}

function openPreview(item: ArtworkItem) {
  previewItem.value = item;
}

function closePreview() {
  previewItem.value = null;
}

function downloadItem(item: ArtworkItem) {
  if (!item.imageUrl) return;
  const link = document.createElement('a');
  link.download = `${item.title}.png`;
  link.href = item.imageUrl;
  link.click();
}

onMounted(loadList);
</script>

<style scoped>
.album-page {
  min-height: 100vh;
  background: #FFF8F0;
  padding-bottom: 40px;
}

.album-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  position: sticky;
  top: 0;
  z-index: 10;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: #333;
  cursor: pointer;
  flex-shrink: 0;
}

.back-btn:hover {
  background: #f5f5f5;
}

.page-title {
  flex: 1;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  color: #333;
  margin: 0;
}

.header-spacer {
  width: 36px;
}

/* ===== Tab 切换 ===== */
.album-tabs {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: #FFF8F0;
}

.tab-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 0;
  border: 1.5px solid #eee;
  border-radius: 14px;
  background: white;
  color: #888;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-btn.active {
  border-color: #FF8C42;
  background: #FFF3E8;
  color: #FF8C42;
  font-weight: 600;
}

.tab-icon {
  flex-shrink: 0;
}

.tab-count {
  font-size: 11px;
  min-width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  border-radius: 10px;
  background: #f5f5f5;
  color: #999;
}

.tab-btn.active .tab-count {
  background: rgba(255, 140, 66, 0.15);
  color: #FF8C42;
}

.album-container {
  max-width: 640px;
  margin: 0 auto;
  padding: 20px 16px;
}

.album-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
  color: #999;
  font-size: 15px;
}

.album-placeholder .spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #f0f0f0;
  border-top-color: #FF8C42;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.album-placeholder p {
  margin: 0;
}

.sub-tip {
  font-size: 13px;
  margin: 8px 0 20px !important;
  color: #bbb;
}

.go-create-btn {
  padding: 10px 28px;
  background: linear-gradient(135deg, #FF8C42, #FFB347);
  color: white;
  border: none;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(255, 140, 66, 0.3);
}

.go-create-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 22px rgba(255, 140, 66, 0.45);
}

/* ===== 作品网格 ===== */
.album-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.album-item {
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  cursor: pointer;
  transition: transform 0.2s;
}

.album-item:hover {
  transform: translateY(-2px);
}

.album-thumb {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}

.item-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 8px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s;
}

.album-item:hover .item-overlay {
  opacity: 1;
}

.item-source {
  background: rgba(255, 255, 255, 0.92);
  color: #FF8C42;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 10px;
  pointer-events: none;
}

.item-delete {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.92);
  color: #ff4d4f;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  transition: background 0.2s;
}

.item-delete:hover {
  background: #ff4d4f;
  color: white;
}

.item-title {
  padding: 10px 12px;
  margin: 0;
  font-size: 13px;
  color: #333;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ===== 大图预览 ===== */
.preview-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.preview-card {
  position: relative;
  background: white;
  border-radius: 20px;
  overflow: hidden;
  max-width: 480px;
  width: 100%;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}

.preview-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.4);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.preview-img {
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
  background: #f5f5f5;
  display: block;
}

.preview-info {
  padding: 20px;
}

.preview-info h3 {
  margin: 0 0 4px;
  font-size: 16px;
  color: #333;
}

.preview-source {
  margin: 0 0 16px;
  font-size: 13px;
  color: #FF8C42;
  font-weight: 500;
}

.preview-actions {
  display: flex;
  gap: 12px;
}

.preview-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid #eee;
  background: #f9f9f9;
  color: #666;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.preview-btn:hover {
  background: #f0f0f0;
}

.preview-btn.danger {
  color: #ff4d4f;
  border-color: #ffccc7;
  background: #fff2f0;
}

.preview-btn.danger:hover {
  background: #ff4d4f;
  color: white;
  border-color: #ff4d4f;
}
</style>
