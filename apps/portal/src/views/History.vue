<template>
  <div class="history-page">
    <!-- 顶部 -->
    <header class="hs-header">
      <button class="hs-back" @click="router.push('/')">← 返回</button>
      <h1 class="hs-title">我的变变</h1>
      <span class="hs-count" v-if="!isEmpty">{{ items.length }}/20</span>
    </header>

    <!-- 空状态 -->
    <div v-if="isEmpty" class="hs-empty">
      <div class="empty-illustration">
        <span class="empty-emoji">📭</span>
      </div>
      <h2 class="empty-title">还没有变过角色～</h2>
      <p class="empty-desc">快去创作第一个角色吧！</p>
      <button class="empty-btn" @click="router.push('/bianbian')">🎨 开始创作</button>
    </div>

    <!-- 网格画廊 -->
    <div v-else class="hs-grid">
      <div
        v-for="(item, idx) in items"
        :key="idx"
        class="hs-card"
        @click="viewItem(item)"
        @longpress.prevent="startLongPress(idx)"
      >
        <div class="card-img-wrapper">
          <img v-if="item.imageUrl" :src="item.imageUrl" alt="变变角色" class="card-img" />
          <span v-else class="card-placeholder">✨</span>
        </div>
        <div class="card-meta">
          <span class="card-desc" v-if="item.description">{{ item.description }}</span>
          <span class="card-time">{{ formatDate(item.timestamp) }}</span>
        </div>
        <div v-if="selectedForDelete.includes(idx)" class="card-check">
          <span>✓</span>
        </div>
      </div>
    </div>

    <!-- 批量删除栏 -->
    <div v-if="deleteMode" class="delete-bar">
      <button class="del-btn cancel" @click="exitDeleteMode">取消</button>
      <span class="del-count">已选 {{ selectedForDelete.length }} 张</span>
      <button class="del-btn confirm" @click="confirmDelete">删除</button>
    </div>

    <!-- 查看大图弹窗 -->
    <div v-if="viewingItem" class="view-overlay" @click.self="viewingItem = null">
      <button class="view-close" @click="viewingItem = null">✕</button>
      <img :src="viewingItem.imageUrl" alt="变变角色" class="view-img" />
      <div class="view-actions">
        <button class="va-btn" @click="saveItem(viewingItem)">💾 保存</button>
        <button class="va-btn danger" @click="deleteSingle(viewingItem)">🗑 删除</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();

interface HistoryItem {
  imageUrl: string;
  description: string;
  timestamp: string;
}

const items = ref<HistoryItem[]>([]);
const isEmpty = computed(() => items.value.length === 0);
const deleteMode = ref(false);
const selectedForDelete = ref<number[]>([]);
const viewingItem = ref<HistoryItem | null>(null);
let longPressTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  loadHistory();
  document.addEventListener('touchend', handleTouchEnd);
  document.addEventListener('touchmove', handleTouchMove);
});

onBeforeUnmount(() => {
  document.removeEventListener('touchend', handleTouchEnd);
  document.removeEventListener('touchmove', handleTouchMove);
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});

function handleTouchEnd() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

function handleTouchMove() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem('bb_history');
    if (raw) {
      items.value = JSON.parse(raw);
    }
  } catch { /* ignore */ }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days === 2) return '前天';
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function viewItem(item: HistoryItem) {
  if (deleteMode.value) return;
  viewingItem.value = item;
}

function saveItem(item: HistoryItem) {
  if (!item.imageUrl) return;
  const link = document.createElement('a');
  link.download = `变变-${Date.now()}.png`;
  link.href = item.imageUrl;
  link.click();
}

function deleteSingle(item: HistoryItem) {
  items.value = items.value.filter((i) => i !== item);
  viewingItem.value = null;
  saveHistory();
}

function startLongPress(idx: number) {
  longPressTimer = setTimeout(() => {
    enterDeleteMode(idx);
  }, 500);
}



function enterDeleteMode(idx: number) {
  deleteMode.value = true;
  selectedForDelete.value = [idx];
}

function exitDeleteMode() {
  deleteMode.value = false;
  selectedForDelete.value = [];
}

function confirmDelete() {
  const selected = [...selectedForDelete.value].sort((a, b) => b - a);
  for (const idx of selected) {
    items.value.splice(idx, 1);
  }
  exitDeleteMode();
  saveHistory();
}

function saveHistory() {
  try {
    localStorage.setItem('bb_history', JSON.stringify(items.value));
  } catch { /* ignore */ }
}
</script>

<style scoped>
.history-page {
  min-height: 100vh;
  min-height: 100dvh;
  background: #FFF8F0;
  padding: 0 16px 32px;
}

/* 顶部 */
.hs-header {
  display: flex;
  align-items: center;
  padding: 16px 0;
  padding-top: max(16px, env(safe-area-inset-top));
  position: sticky;
  top: 0;
  background: rgba(255, 248, 240, 0.95);
  backdrop-filter: blur(12px);
  z-index: 10;
}

.hs-back {
  border: none;
  background: none;
  color: #FF8C42;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  padding: 8px 4px;
  transition: color 0.2s;
}

.hs-title {
  flex: 1;
  text-align: center;
  font-size: 18px;
  font-weight: 700;
  color: #333;
  margin: 0;
}

.hs-count {
  font-size: 13px;
  color: #aaa;
  padding: 8px 4px;
}

/* 空状态 */
.hs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}

.empty-illustration {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: rgba(255, 140, 66, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
}

.empty-emoji { font-size: 56px; }

.empty-title {
  font-size: 20px;
  font-weight: 700;
  color: #333;
  margin: 0 0 8px;
}

.empty-desc {
  font-size: 15px;
  color: #888;
  margin: 0 0 24px;
}

.empty-btn {
  padding: 14px 36px;
  border: none;
  border-radius: 18px;
  background: linear-gradient(135deg, #FF8C42, #FFB347);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 20px rgba(255, 140, 66, 0.25);
}

.empty-btn:active { transform: scale(0.97); }

/* 网格 */
.hs-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 8px 0 80px;
}

.hs-card {
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.hs-card:active {
  transform: scale(0.97);
}

.card-img-wrapper {
  width: 100%;
  aspect-ratio: 1;
  background: #f5f0eb;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.card-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-placeholder {
  font-size: 32px;
  opacity: 0.4;
}

.card-meta {
  padding: 8px 10px;
}

.card-desc {
  display: block;
  font-size: 12px;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-time {
  display: block;
  font-size: 11px;
  color: #bbb;
  margin-top: 2px;
}

.card-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #FF8C42;
  color: #fff;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 批量删除栏 */
.delete-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  padding-bottom: max(14px, env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #f0f0f0;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.04);
  z-index: 50;
}

.del-count {
  font-size: 14px;
  color: #666;
}

.del-btn {
  padding: 10px 24px;
  border: none;
  border-radius: 14px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.del-btn.cancel {
  background: #f0f0f0;
  color: #666;
}

.del-btn.confirm {
  background: #ff4757;
  color: #fff;
}

/* 查看大图 */
.view-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.view-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.view-img {
  max-width: 90%;
  max-height: 65%;
  border-radius: 16px;
  object-fit: contain;
}

.view-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}

.va-btn {
  padding: 12px 32px;
  border: none;
  border-radius: 16px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  color: #fff;
  background: rgba(255, 255, 255, 0.15);
  transition: all 0.2s;
}

.va-btn.danger {
  background: rgba(255, 71, 87, 0.5);
}

@media (min-width: 768px) {
  .history-page {
    max-width: 480px;
    margin: 0 auto;
  }
  .hs-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
