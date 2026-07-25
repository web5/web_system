<template>
  <div class="transform-page">
    <!-- 顶部（返回按钮） -->
    <header class="tf-header">
      <button class="tf-back" @click="handleCancel">← 返回</button>
    </header>

    <!-- 原画缩略图 -->
    <div class="tf-preview">
      <div class="preview-thumb" :class="{ pulsing: !isFailed }">
        <div class="preview-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><circle cx="8.5" cy="10" r="1.5" fill="currentColor" stroke="none" opacity="0.3"/><circle cx="15.5" cy="10" r="1.5" fill="currentColor" stroke="none" opacity="0.3"/></svg>
        </div>
      </div>
      <p class="preview-label" v-if="description">{{ description }}</p>
    </div>

    <!-- 状态区 -->
    <div class="tf-status-area">
      <!-- 变变中 -->
      <div v-if="!isFailed && !isDone" class="status-transforming">
        <div class="tf-arrow">↓</div>
        <h2 class="tf-title">正在变身...</h2>
        <p class="tf-hint">{{ statusHint }}</p>

        <!-- 进度条 -->
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <p class="progress-text">{{ progressText }}</p>

        <!-- 趣味小知识（15秒后出现） -->
        <div v-if="elapsedTime > 15" class="fun-fact">
          <div class="fact-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
          </div>
          <p class="fact-text">{{ currentFunFact }}</p>
        </div>
      </div>

      <!-- 成功 -->
      <div v-if="isDone" class="status-success">
        <div class="success-flash"></div>
        <div class="success-icon">
          <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        </div>
        <h2 class="tf-title">变身成功！</h2>
        <p class="tf-hint">正在跳转到结果页...</p>
      </div>

      <!-- 失败 -->
      <div v-if="isFailed" class="status-failed">
        <div class="fail-icon">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </div>
        <h2 class="tf-title">变身失败了</h2>
        <p class="tf-hint">{{ failMessage }}</p>
        <div class="fail-actions">
          <button class="fail-btn retry-btn" @click="handleRetry">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>再变一次
          </button>
          <button class="fail-btn back-btn" @click="handleCancel">← 回去再改改</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { transformImage } from '@/api/bianbian';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

const description = ref('');
const isFailed = ref(false);
const isDone = ref(false);
const failMessage = ref('');
const elapsedTime = ref(0);
const progressPercent = ref(0);
const progressText = ref('准备中...');
let timer: ReturnType<typeof setInterval> | null = null;
let mounted = false;
let imageData = '';

const hints = [
  '魔法正在施展中，请耐心等待～',
  '把想象变成 3D 角色中...',
  '画得越用心，变得越好看哦',
  '还在努力中，稍等一下～',
  '好的作品需要一点点时间...',
];

const funFacts = [
  '皮克斯的动画师平均需要 1 周制作一个角色，但变变只需要几秒钟！',
  '每一个变变角色都是独一无二的，就像你的想象力一样～',
  '你知道吗？变变里有魔法，能把涂鸦变成活生生的角色！',
  '世界上没有两张完全相同的画，也没有两个完全相同的变变角色～',
  '创作是最好的表达方式，每个孩子都是天生的艺术家！',
];

const statusHint = ref(hints[0]);
const currentFunFact = ref(funFacts[0]);

onMounted(() => {
  mounted = true;
  startTransform();
});

onBeforeUnmount(() => {
  mounted = false;
  cleanup();
});

function cleanup() {
  if (timer) clearInterval(timer);
}

function isActive(): boolean {
  return mounted && !isDone.value;
}

async function startTransform() {
  // 读取画布数据
  try {
    const raw = localStorage.getItem('bb_transform_data');
    if (raw) {
      const data = JSON.parse(raw);
      imageData = data.image || '';
      description.value = data.description || '';
    }
  } catch { /* ignore */ }

  if (!imageData) {
    isFailed.value = true;
    failMessage.value = '没有找到待变身的作品，回去画一张吧～';
    return;
  }

  // 开始进度动画
  let hintIdx = 0;
  let factIdx = 0;
  timer = setInterval(() => {
    elapsedTime.value++;
    if (elapsedTime.value <= 10) {
      progressPercent.value = Math.min(90, elapsedTime.value * 4 + Math.random() * 5);
    } else {
      progressPercent.value = Math.min(95, 90 + (elapsedTime.value - 10) * 0.3);
    }
    if (elapsedTime.value % 5 === 0) {
      hintIdx = (hintIdx + 1) % hints.length;
      statusHint.value = hints[hintIdx];
    }
    if (elapsedTime.value < 3) progressText.value = '正在分析你的作品...';
    else if (elapsedTime.value < 8) progressText.value = 'AI 正在创作角色...';
    else if (elapsedTime.value < 15) progressText.value = '还在努力中，请耐心等待～';
    else progressText.value = `已经${elapsedTime.value}秒了，还在加油中...`;
    if (elapsedTime.value >= 15 && elapsedTime.value % 3 === 0) {
      factIdx = (factIdx + 1) % funFacts.length;
      currentFunFact.value = funFacts[factIdx];
    }
    // 前端兜底超时（略大于接口 120s 超时，避免误杀正常请求）
    if (elapsedTime.value >= 120) {
      cleanup();
      isFailed.value = true;
      failMessage.value = '变身超时了～可能是网络不太稳定，再试一次？';
    }
  }, 1000);

  // 调用变变专用 API
  try {
    const userId = userStore.userInfo?.id?.toString() || '';
    const res = await transformImage({
      image: imageData,
      description: description.value,
      userId,
      roles: userStore.userInfo?.roles,
    });

    if (!isActive()) return;

    if (res.code === 0 && res.data?.aiImage) {
      // 保存结果；原画 base64 可能较大，localStorage 溢出时仍继续跳转，
      // Result 页会 fallback 从 bb_transform_data 读取原画。
      // 优先使用后端返回的临时图片 URL（短链接，避免 localStorage 溢出）
      const originalImage = res.data.originalImageUrl || imageData;
      try {
        localStorage.setItem('bb_result_data', JSON.stringify({
          originalDescription: description.value,
          originalImage,
          aiImageUrl: res.data.aiImage,
          processingTimeMs: res.data.processingTimeMs,
          remainingToday: res.data.remainingToday,
          timestamp: new Date().toISOString(),
        }));
      } catch (e) {
        console.warn('结果数据本地存储失败，将尝试回退读取', e);
      }
      isDone.value = true;
      setTimeout(() => router.replace('/bianbian/result'), 1200);
    } else {
      isFailed.value = true;
      failMessage.value = res.message || '变身出了点小问题，再试一次？';
    }
  } catch (error: any) {
    if (!isActive()) return;
    isFailed.value = true;
    const msg = error?.response?.data?.message || error.message || '';
    if (msg.includes('次数已用完')) {
      failMessage.value = '今日变身次数已用完，明天再来吧～';
    } else if (msg.includes('不清晰')) {
      failMessage.value = '这张画不太清楚～可以再画一张试试吗？';
    } else if (msg.includes('不适宜')) {
      failMessage.value = '换一张画试试吧，变变最喜欢可爱的画了！';
    } else {
      failMessage.value = msg || '出了点小问题，再试一次？';
    }
  }
}

function handleRetry() {
  isFailed.value = false;
  elapsedTime.value = 0;
  progressPercent.value = 0;
  failMessage.value = '';
  startTransform();
}

function handleCancel() {
  cleanup();
  router.push('/bianbian');
}
</script>

<style scoped>
.transform-page {
  background: linear-gradient(180deg, #FFF8F0 0%, #FFEDE0 50%, #FFF8F0 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 24px;
}

/* 顶部 */
.tf-header {
  width: 100%;
  padding: 16px 0;
  display: flex;
  align-items: center;
}

.tf-back {
  border: none;
  background: none;
  color: #888;
  font-size: 15px;
  cursor: pointer;
  padding: 8px 4px;
  transition: color 0.2s;
}

.tf-back:hover { color: #FF8C42; }

/* 原画预览 */
.tf-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 40px 0 32px;
}

.preview-thumb {
  width: 120px;
  height: 120px;
  border-radius: 24px;
  background: #fff;
  border: 2px solid rgba(255, 140, 66, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
}

.preview-thumb.pulsing {
  animation: thumbPulse 1.5s ease-in-out infinite;
}

@keyframes thumbPulse {
  0%, 100% { transform: scale(1); box-shadow: 0 8px 32px rgba(255, 140, 66, 0.12); }
  50% { transform: scale(1.05); box-shadow: 0 12px 40px rgba(255, 140, 66, 0.2); }
}

.preview-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-label {
  margin-top: 12px;
  font-size: 14px;
  color: #888;
  max-width: 200px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 状态区 */
.tf-status-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 360px;
  text-align: center;
}

.tf-arrow {
  font-size: 32px;
  color: #FF8C42;
  animation: arrowBounce 1s ease-in-out infinite;
  margin-bottom: 16px;
}

@keyframes arrowBounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(8px); }
}

.tf-title {
  font-size: 24px;
  font-weight: 700;
  color: #333;
  margin: 0 0 8px;
}

.tf-hint {
  font-size: 15px;
  color: #888;
  margin: 0 0 24px;
  line-height: 1.5;
}

/* 进度条 */
.progress-bar {
  width: 100%;
  height: 8px;
  background: rgba(255, 140, 66, 0.1);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #FF8C42, #FFB347);
  border-radius: 4px;
  transition: width 0.5s ease;
}

.progress-text {
  font-size: 13px;
  color: #aaa;
  margin: 0 0 24px;
}

/* 趣味小知识 */
.fun-fact {
  background: rgba(255, 140, 66, 0.06);
  border: 1px solid rgba(255, 140, 66, 0.1);
  border-radius: 16px;
  padding: 16px 20px;
  margin-top: 8px;
  animation: fadeIn 0.5s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.fact-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
  color: #888;
}

.fact-text {
  font-size: 13px;
  color: #666;
  margin: 0;
  line-height: 1.6;
}

/* 成功状态 */
.status-success {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.success-flash {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  animation: flash 0.3s ease-out;
  pointer-events: none;
}

@keyframes flash {
  from { opacity: 1; }
  to { opacity: 0; }
}

.success-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7ED957;
  animation: successPop 0.5s ease;
}

@keyframes successPop {
  0% { transform: scale(0.5); opacity: 0; }
  60% { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
}

/* 失败状态 */
.status-failed {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.fail-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  color: #888;
}

.fail-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.fail-btn {
  padding: 12px 28px;
  border: none;
  border-radius: 16px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.fail-btn:active { transform: scale(0.96); }

.retry-btn {
  background: linear-gradient(135deg, #FF8C42, #FFB347);
  color: #fff;
  box-shadow: 0 4px 16px rgba(255, 140, 66, 0.25);
}

.back-btn {
  background: #fff;
  color: #888;
  border: 1px solid #e0e0e0;
}


/* ===== 响应式 - PC ===== */
@media (min-width: 768px) {
  .transform-page {
    max-width: 100%;
    min-height: 100vh;
    margin: 0 auto;
    padding: 0 48px;
  }

  .tf-header {
    padding: 24px 0;
    max-width: 600px;
    margin: 0 auto;
  }

  .tf-preview {
    margin: 60px 0 40px;
  }

  .preview-thumb {
    width: 160px;
    height: 160px;
    border-radius: 28px;
  }

  .tf-status-area {
    max-width: 500px;
  }

  .tf-title {
    font-size: 28px;
  }

  .progress-bar {
    height: 10px;
  }

  .fun-fact {
    max-width: 420px;
  }
}
</style>
