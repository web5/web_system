<template>
  <div class="result-page">
    <!-- 顶部（生成结果提示） -->
    <header class="rs-header">
      <span class="rs-badge">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:4px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>变身完成
      </span>
    </header>

    <!-- 对比展示 -->
    <div class="rs-comparison">
      <div class="rs-card card-original">
        <div class="card-label">原画</div>
        <div class="card-thumb original-thumb" @click="previewOriginal">
          <img v-if="originalImageUrl && !originalImageError" :src="originalImageUrl" alt="原画" class="result-img" @error="originalImageError = true" />
          <div v-else class="thumb-placeholder">
            <svg class="thumb-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><circle cx="8.5" cy="10" r="1.5" fill="currentColor" stroke="none" opacity="0.3"/><circle cx="15.5" cy="10" r="1.5" fill="currentColor" stroke="none" opacity="0.3"/></svg>
            <span class="thumb-placeholder-text">原画未加载</span>
          </div>
        </div>
      </div>
      <div class="rs-arrow">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/></svg>
      </div>
      <div class="rs-card card-result" @click="previewFull">
        <div class="card-label">AI 角色</div>
        <div class="card-thumb result-thumb">
          <img v-if="aiImageUrl" :src="aiImageUrl" alt="AI 角色" class="result-img" />
          <svg v-else class="thumb-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
      </div>
    </div>

    <!-- 描述 -->
    <p v-if="description" class="rs-description">「{{ description }}」</p>

    <!-- 操作按钮 -->
    <div class="rs-actions">
      <!-- 保存按钮：原画 + AI -->
      <div class="save-row">
        <button class="action-btn btn-save-design" @click="handleSaveOriginal" :disabled="savingOriginal || !originalImageUrl">
          <svg v-if="!savingOriginal" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          <span>{{ savingOriginal ? '保存中...' : '保存原画' }}</span>
        </button>
        <button class="action-btn btn-save-ai" @click="handleSaveAI" :disabled="savingAI || !aiImageUrl">
          <svg v-if="!savingAI" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          <span>{{ savingAI ? '保存中...' : '保存AI角色' }}</span>
        </button>
      </div>

      <div class="action-row">
        <button class="action-btn btn-secondary" @click="handleRetry" :disabled="retryCount <= 0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <span>重新变{{ retryCount > 0 ? ` (还余${retryCount}次)` : '' }}</span>
        </button>
        <button class="action-btn btn-secondary" @click="handleNew">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>再创一个</span>
        </button>
      </div>

      <p v-if="retryCount <= 0" class="retry-limit">今天变够啦，明天继续！</p>
    </div>

    <!-- 提示 -->
    <div class="rs-tip">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:4px"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>不满意？点「重新变」用同一张画再试一次
    </div>

    <!-- 全屏预览遮罩 -->
    <div v-if="showPreview" class="preview-overlay" @click="showPreview = false">
      <button class="preview-close" @click="showPreview = false">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <img :src="previewImageUrl" alt="预览" class="preview-img" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { getQuota } from '@/api/bianbian';
import { saveArtwork } from '@/api/artworks';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

const aiImageUrl = ref('');
const originalImageUrl = ref('');
const originalImageError = ref(false);
const description = ref('');
const retryCount = ref(0);
const showPreview = ref(false);
const previewImageUrl = ref('');
const savingOriginal = ref(false);
const savingAI = ref(false);

onMounted(() => {
  loadResult();
  fetchQuota();
});

function loadResult() {
  let loadedFromResult = false;

  // 读取主结果数据（独立 try/catch，避免 parse 失败导致 fallback 不执行）
  try {
    const raw = localStorage.getItem('bb_result_data');
    if (raw) {
      const data = JSON.parse(raw);
      aiImageUrl.value = data.aiImageUrl || '';
      originalImageUrl.value = data.originalImage || '';
      description.value = data.originalDescription || '';
      retryCount.value = data.remainingToday ?? 0;
      loadedFromResult = true;
    }
  } catch {
    // bb_result_data 可能因 localStorage 配额截断导致 JSON 损坏
    console.warn('读取 bb_result_data 失败，数据可能已损坏');
  }

  // fallback：结果中未写入原画时，从待变身数据里读取（独立 try/catch）
  if (!originalImageUrl.value) {
    try {
      const transformRaw = localStorage.getItem('bb_transform_data');
      if (transformRaw) {
        const transformData = JSON.parse(transformRaw);
        originalImageUrl.value = transformData.image || '';
        if (!description.value) description.value = transformData.description || '';
      }
    } catch {
      console.warn('读取 bb_transform_data 回退也失败');
    }
  }

  // 末级 fallback：若结果页完全没数据，试试只从 bb_transform_data 重建
  if (!loadedFromResult && !aiImageUrl.value) {
    try {
      const transformRaw = localStorage.getItem('bb_transform_data');
      if (transformRaw) {
        const transformData = JSON.parse(transformRaw);
        if (!originalImageUrl.value) originalImageUrl.value = transformData.image || '';
        if (!description.value) description.value = transformData.description || '';
      }
    } catch { /* ignore */ }
  }
}

async function fetchQuota() {
  try {
    const userId = userStore.userInfo?.id?.toString() || '';
    if (!userId) return;
    const roles = userStore.userInfo?.roles;
    const res = await getQuota(userId, roles);
    if (res.code === 0 && res.data) {
      retryCount.value = res.data.remaining;
    }
  } catch { /* 静默，使用已有次数 */ }
}

async function handleSaveOriginal() {
  if (!originalImageUrl.value || savingOriginal.value) return;
  savingOriginal.value = true;
  await doSave(originalImageUrl.value, 'design', '设计相册', '原画');
  savingOriginal.value = false;
}

async function handleSaveAI() {
  if (!aiImageUrl.value || savingAI.value) return;
  savingAI.value = true;
  await doSave(aiImageUrl.value, 'ai-art', 'AI相册', 'AI角色');
  savingAI.value = false;
}

async function doSave(imageUrl: string, sourceType: 'design' | 'ai-art', albumName: string, label: string) {
  // 保存到本地历史
  try {
    const raw = localStorage.getItem('bb_history');
    const history = raw ? JSON.parse(raw) : [];
    history.unshift({
      imageUrl,
      description: description.value,
      sourceType,
      timestamp: new Date().toISOString(),
    });
    if (history.length > 20) history.length = 20;
    localStorage.setItem('bb_history', JSON.stringify(history));
  } catch { /* ignore */ }

  // 登录用户同步到云端相册
  const userId = userStore.userInfo?.id;
  if (userId) {
    try {
      const res = await saveArtwork({
        userId,
        title: description.value || '变变作品',
        imageUrl,
        sourceType,
        prompt: description.value,
      });
      if (res.code === 0) {
        message.success(`已保存${label}到${albumName}`);
      } else {
        message.error(res.message || '云端保存失败，已保留到本地');
      }
    } catch {
      message.error('云端保存失败，已保留到本地');
    }
  } else {
    message.success(`已保存${label}到本地`);
  }
}

function handleRetry() {
  if (retryCount.value <= 0) return;
  retryCount.value--;
  localStorage.setItem('bb_retry_count', String(retryCount.value));
  router.push('/bianbian/transform');
}

function handleNew() {
  // 清除画布数据
  localStorage.removeItem('bb_draft');
  localStorage.removeItem('bb_transform_data');
  router.push('/bianbian');
}

function previewOriginal() {
  if (originalImageUrl.value && !originalImageError.value) {
    previewImageUrl.value = originalImageUrl.value;
    showPreview.value = true;
  }
}

function previewFull() {
  if (aiImageUrl.value) {
    previewImageUrl.value = aiImageUrl.value;
    showPreview.value = true;
  }
}
</script>

<style scoped>
.result-page {
  min-height: 100vh;
  min-height: 100dvh;
  background: linear-gradient(180deg, #FFF8F0 0%, #FFEDE0 50%, #FFF8F0 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 24px;
  animation: pageIn 0.4s ease;
}

@keyframes pageIn {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 顶部 */
.rs-header {
  padding: 24px 0 20px;
  text-align: center;
}

.rs-badge {
  display: inline-block;
  padding: 8px 24px;
  background: rgba(126, 217, 87, 0.1);
  border: 1px solid rgba(126, 217, 87, 0.2);
  border-radius: 20px;
  color: #5CB85C;
  font-size: 16px;
  font-weight: 700;
}

/* 对比展示 */
.rs-comparison {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.rs-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.card-label {
  font-size: 13px;
  color: #888;
  font-weight: 500;
}

.card-original .card-label { color: #aaa; }
.card-result .card-label { color: #FF8C42; font-weight: 600; }

.card-thumb {
  width: 140px;
  height: 140px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.original-thumb {
  background: #fff;
  border: 1.5px solid #e0e0e0;
  cursor: pointer;
}

.result-thumb {
  background: #fff;
  border: 2px solid #FF8C42;
  cursor: pointer;
  transition: transform 0.2s;
}

.result-thumb:hover {
  transform: scale(1.03);
}

.thumb-icon {
  color: #bbb;
}

.thumb-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.thumb-placeholder-text {
  font-size: 12px;
  color: #bbb;
}

.result-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rs-arrow {
  display: flex;
  align-items: center;
  color: #FF8C42;
  animation: arrowGlow 1.5s ease-in-out infinite;
}

@keyframes arrowGlow {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.2); }
}

/* 描述 */
.rs-description {
  font-size: 15px;
  color: #666;
  font-style: italic;
  margin: 0 0 28px;
  max-width: 320px;
  text-align: center;
  line-height: 1.5;
}

/* 操作按钮 */
.rs-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 360px;
  margin-bottom: 20px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 24px;
  border: none;
  border-radius: 18px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:active { transform: scale(0.97); }

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.save-row {
  display: flex;
  gap: 10px;
  width: 100%;
}

.btn-save-design {
  flex: 1;
  background: #fff;
  color: #888;
  border: 1.5px solid #e0e0e0;
}

.btn-save-design:hover:not(:disabled) {
  border-color: #FF8C42;
  color: #FF8C42;
  background: #FFF3E8;
}

.btn-save-ai {
  flex: 1;
  background: linear-gradient(135deg, #FF8C42, #FFB347);
  color: #fff;
  box-shadow: 0 6px 24px rgba(255, 140, 66, 0.3);
}

.action-row {
  display: flex;
  gap: 10px;
  width: 100%;
}

.btn-secondary {
  flex: 1;
  background: #fff;
  color: #666;
  border: 1.5px solid #e0e0e0;
  font-size: 14px;
}

.btn-secondary:active {
  background: #FFF8F0;
  border-color: #FF8C42;
  color: #FF8C42;
}

.action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.retry-limit {
  font-size: 13px;
  color: #bbb;
  margin: 0;
}

/* 提示 */
.rs-tip {
  background: rgba(255, 140, 66, 0.05);
  border: 1px solid rgba(255, 140, 66, 0.08);
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 13px;
  color: #999;
  max-width: 360px;
  width: 100%;
  text-align: center;
  margin-top: auto;
  margin-bottom: 32px;
}

/* 全屏预览 */
.preview-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.preview-close {
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

.preview-img {
  max-width: 90%;
  max-height: 80%;
  border-radius: 16px;
  object-fit: contain;
}

/* ===== 响应式 - PC ===== */
@media (min-width: 768px) {
  .result-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 48px 40px;
    min-height: 100vh;
  }

  .rs-header {
    padding: 40px 0 32px;
  }

  .rs-badge {
    padding: 12px 36px;
    font-size: 18px;
  }

  .rs-comparison {
    gap: 40px;
    margin-bottom: 28px;
  }

  .rs-card {
    gap: 14px;
  }

  .card-label {
    font-size: 15px;
  }

  .card-thumb {
    width: 280px;
    height: 280px;
    border-radius: 28px;
  }

  .rs-description {
    font-size: 16px;
    max-width: 480px;
    margin-bottom: 36px;
  }

  .rs-actions {
    max-width: 520px;
    gap: 14px;
  }

  .action-btn {
    padding: 16px 32px;
    font-size: 17px;
  }

  .btn-secondary {
    font-size: 15px;
  }

  .rs-tip {
    max-width: 520px;
    font-size: 14px;
  }
}

@media (min-width: 1200px) {
  .rs-comparison {
    gap: 60px;
  }

  .card-thumb {
    width: 340px;
    height: 340px;
  }
}
</style>
