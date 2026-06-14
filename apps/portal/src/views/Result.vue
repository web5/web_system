<template>
  <div class="result-page">
    <!-- 顶部 -->
    <header class="rs-header">
      <span class="rs-badge">✨ 变变成功！</span>
    </header>

    <!-- 对比展示 -->
    <div class="rs-comparison">
      <div class="rs-card card-original">
        <div class="card-label">原画</div>
        <div class="card-thumb original-thumb">
          <span class="thumb-emoji">🎨</span>
        </div>
      </div>
      <div class="rs-arrow">→</div>
      <div class="rs-card card-result" @click="previewFull">
        <div class="card-label">AI 角色</div>
        <div class="card-thumb result-thumb">
          <img v-if="aiImageUrl" :src="aiImageUrl" alt="AI 角色" class="result-img" />
          <span v-else class="thumb-emoji">✨</span>
        </div>
      </div>
    </div>

    <!-- 描述 -->
    <p v-if="description" class="rs-description">「{{ description }}」</p>

    <!-- 操作按钮 -->
    <div class="rs-actions">
      <button class="action-btn btn-save" @click="handleSave">
        <span>❤️</span>
        <span>保存到相册</span>
      </button>

      <div class="action-row">
        <button class="action-btn btn-secondary" @click="handleRetry" :disabled="retryCount <= 0">
          <span>🎲</span>
          <span>重新变{{ retryCount > 0 ? ` (还余${retryCount}次)` : '' }}</span>
        </button>
        <button class="action-btn btn-secondary" @click="handleNew">
          <span>✨</span>
          <span>再创一个</span>
        </button>
      </div>

      <p v-if="retryCount <= 0" class="retry-limit">今天变够啦，明天继续！</p>
    </div>

    <!-- 提示 -->
    <div class="rs-tip">
      <span>💡 不满意？点「重新变」让变变用同一张画再试一次</span>
    </div>

    <!-- 全屏预览遮罩 -->
    <div v-if="showPreview" class="preview-overlay" @click="showPreview = false">
      <button class="preview-close" @click="showPreview = false">✕</button>
      <img :src="aiImageUrl" alt="AI 角色" class="preview-img" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';

const router = useRouter();

const aiImageUrl = ref('');
const description = ref('');
const retryCount = ref(2);
const showPreview = ref(false);

onMounted(() => {
  loadResult();
});

function loadResult() {
  try {
    const raw = localStorage.getItem('bb_result_data');
    if (raw) {
      const data = JSON.parse(raw);
      aiImageUrl.value = data.aiImageUrl || '';
      description.value = data.originalDescription || '';
    }
  } catch { /* ignore */ }

  // 读取重试次数
  const today = new Date().toDateString();
  const stored = localStorage.getItem('bb_retry_date');
  if (stored === today) {
    retryCount.value = parseInt(localStorage.getItem('bb_retry_count') || '2', 10);
  } else {
    localStorage.setItem('bb_retry_date', today);
    localStorage.setItem('bb_retry_count', '2');
    retryCount.value = 2;
  }
}

function handleSave() {
  if (!aiImageUrl.value) return;

  // 保存到本地历史
  try {
    const raw = localStorage.getItem('bb_history');
    const history = raw ? JSON.parse(raw) : [];
    history.unshift({
      imageUrl: aiImageUrl.value,
      description: description.value,
      timestamp: new Date().toISOString(),
    });
    // 最多 20 张
    if (history.length > 20) history.length = 20;
    localStorage.setItem('bb_history', JSON.stringify(history));
  } catch { /* ignore */ }

  // 尝试下载
  const link = document.createElement('a');
  link.download = `变变-${Date.now()}.png`;
  link.href = aiImageUrl.value;
  link.click();
  message.success('已保存到本地');
}

function handleRetry() {
  if (retryCount.value <= 0) return;
  retryCount.value--;
  localStorage.setItem('bb_retry_count', String(retryCount.value));
  router.push('/transform');
}

function handleNew() {
  // 清除画布数据
  localStorage.removeItem('bb_draft');
  localStorage.removeItem('bb_transform_data');
  router.push('/create');
}

function previewFull() {
  if (aiImageUrl.value) showPreview.value = true;
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

.thumb-emoji {
  font-size: 48px;
}

.result-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rs-arrow {
  font-size: 28px;
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

.btn-save {
  width: 100%;
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

.btn-secondary:disabled {
  opacity: 0.4;
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

@media (min-width: 768px) {
  .result-page {
    max-width: 480px;
    margin: 0 auto;
  }
  .card-thumb { width: 160px; height: 160px; }
}
</style>
