<template>
  <div class="draw-page">
    <!-- 顶部品牌已迁移到全局 App.vue。这里保留二级子导航（返回 + 页面标题） -->
    <div class="sub-header">
      <div class="sub-header-inner">
        <button class="back-btn back-btn--mobile-only" @click="$router.push('/')">← 返回首页</button>
        <span class="page-title">创意画板</span>
      </div>
    </div>

    <!-- 模式切换 -->
    <div class="mode-tabs">
      <button
        class="mode-tab"
        :class="{ active: activeMode === 'draw' }"
        @click="activeMode = 'draw'"
      >
        <svg class="mode-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span>自由绘画</span>
      </button>
      <button
        class="mode-tab"
        :class="{ active: activeMode === 'ai' }"
        @click="activeMode = 'ai'"
      >
        <svg class="mode-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        <span>AI 生成</span>
      </button>
    </div>

    <!-- ====== 自由绘画模式 ====== -->
    <div v-if="activeMode === 'draw'" class="canvas-wrapper">
      <div class="toolbar">
        <div class="tool-group">
          <label>工具：</label>
          <a-radio-group v-model:value="tool" button-style="solid">
            <a-radio-button value="brush">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M11.08 13.98a2.5 2.5 0 0 1-3.53 3.54L3 14l6.06-6.06"/></svg>画笔
            </a-radio-button>
            <a-radio-button value="eraser">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><line x1="5" y1="11" x2="19" y2="11"/></svg>橡皮
            </a-radio-button>
          </a-radio-group>
        </div>

        <div class="tool-group">
          <label>颜色：</label>
          <input type="color" v-model="color" class="color-picker" />
          <div class="color-presets">
            <button
              v-for="c in colorPresets"
              :key="c"
              :style="{ backgroundColor: c }"
              @click="color = c"
              class="color-btn"
              :class="{ active: color === c }"
            ></button>
          </div>
        </div>

        <div class="tool-group">
          <label>粗细：{{ brushSize }}px</label>
          <a-slider v-model:value="brushSize" :min="1" :max="50" style="width: 150px" />
        </div>

        <div class="tool-group">
          <a-button @click="clearCanvas">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>清空
          </a-button>
          <a-button @click="undo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>撤销
          </a-button>
          <a-button @click="saveCanvas" type="primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>保存
          </a-button>
        </div>
      </div>

      <div class="canvas-container">
        <canvas
          ref="canvasRef"
          @mousedown="startDrawing"
          @mousemove="draw"
          @mouseup="stopDrawing"
          @mouseleave="stopDrawing"
          @touchstart="handleTouchStart"
          @touchmove="handleTouchMove"
          @touchend="stopDrawing"
        ></canvas>
      </div>
    </div>

    <!-- ====== AI 生成模式 ====== -->
    <div v-if="activeMode === 'ai'" class="ai-gen-wrapper">
      <!-- 生成控制区 -->
      <div class="gen-panel">
        <div class="gen-header">
          <h2 class="gen-title">AI 创意绘画</h2>
          <p class="gen-desc">输入描述文字，AI 为你生成独一无二的作品</p>
        </div>

        <div class="gen-input-area">
          <div class="input-row">
            <textarea
              v-model="genPrompt"
              class="gen-input"
              placeholder="描述你想画的画面，例如：阳光下的小猫在花园里玩耍..."
              :rows="2"
              :disabled="genStatus === 'generating'"
              @keydown.enter.exact.prevent="handleGenerate"
            ></textarea>
            <button
              class="gen-btn"
              :disabled="!genPrompt.trim() || genStatus === 'generating'"
              @click="handleGenerate"
              :class="{ disabled: !genPrompt.trim() || genStatus === 'generating' }"
            >
              <span v-if="genStatus === 'generating'" class="spinner"></span>
              <span v-else>生成</span>
            </button>
          </div>
        </div>

        <!-- 快捷提示 -->
        <div class="gen-suggestions" v-if="genStatus === 'idle'">
          <span class="suggest-label">试试这些：</span>
          <button
            v-for="item in genSuggestions"
            :key="item.prompt"
            class="suggest-tag"
            @click="genPrompt = item.prompt; handleGenerate()"
          >
            <span v-html="item.icon" style="vertical-align:-3px;margin-right:2px;display:inline-block;width:14px;height:14px"></span>{{ item.prompt }}
          </button>
        </div>
      </div>

      <!-- 生成结果区 -->
      <div class="gen-result-area">
        <!-- 状态：空闲 -->
        <div v-if="genStatus === 'idle' && !genImageUrl" class="gen-placeholder">
          <div class="placeholder-icon">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><circle cx="8.5" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>
          </div>
          <h3>AI 画布</h3>
          <p>输入描述文字，让 AI 为你创作</p>
        </div>

        <!-- 状态：生成中 -->
        <div v-if="genStatus === 'generating'" class="gen-loading">
          <div class="loading-pulse"></div>
          <h3>AI 正在创作中...</h3>
          <p class="loading-hint">这可能需要十几秒，请耐心等待</p>
          <div class="loading-dots">
            <span class="ldot"></span>
            <span class="ldot"></span>
            <span class="ldot"></span>
          </div>
        </div>

        <!-- 状态：生成完成 -->
        <div v-if="genStatus === 'done' && genImageUrl" class="gen-done">
          <div class="result-image-wrapper">
            <img :src="genImageUrl" :alt="genPrompt" class="result-image" @load="genStatus = 'done'" />
            <div class="result-overlay">
              <button class="overlay-btn primary" @click="saveToAlbum" :disabled="savingToAlbum" title="保存到相册">
                <svg v-if="!savingToAlbum" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                <span>{{ savingToAlbum ? '保存中' : '保存到相册' }}</span>
              </button>
              <button class="overlay-btn" @click="downloadGenImage" title="下载图片">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>下载
              </button>
              <button class="overlay-btn" @click="copyGenImage" title="复制图片">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>复制
              </button>
              <button class="overlay-btn" @click="regenerate" title="重新生成">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>重试
              </button>
            </div>
          </div>
          <p class="result-prompt">「{{ genPrompt }}」</p>
        </div>

        <!-- 状态：失败 -->
        <div v-if="genStatus === 'failed'" class="gen-error">
          <div class="error-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
          </div>
          <h3>生成失败</h3>
          <p>{{ genErrorMsg }}</p>
          <a-button type="primary" @click="resetGen">重新开始</a-button>
        </div>
      </div>

      <!-- 历史记录 -->
      <div class="gen-history" v-if="genHistory.length > 0">
        <h3 class="history-title">最近生成</h3>
        <div class="history-grid">
          <div
            v-for="(item, idx) in genHistory"
            :key="idx"
            class="history-item"
            @click="genImageUrl = item.url; genPrompt = item.prompt; genStatus = 'done'"
          >
            <img :src="item.url" :alt="item.prompt" class="history-thumb" />
            <div class="history-info">
              <span class="history-prompt">{{ item.prompt }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { message } from 'ant-design-vue';
import { submitImage, queryImage } from '@/api/ai';
import { saveArtwork } from '@/api/artworks';
import { useUserStore } from '@/stores/user';

// ====== 手动绘画 ======
const canvasRef = ref<HTMLCanvasElement | null>(null);
const ctx = ref<CanvasRenderingContext2D | null>(null);
const isDrawing = ref(false);
const tool = ref('brush');
const color = ref('#f97316');
const brushSize = ref(5);
const history = ref<ImageData[]>([]);
const historyIndex = ref(-1);
const activeMode = ref<'draw' | 'ai'>('ai');

const colorPresets = ['#f97316', '#ea580c', '#f093fb', '#f5576c', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#000000', '#ffffff'];

let lastX = 0;
let lastY = 0;

// ====== AI 生成 ======
const genPrompt = ref('');
const genStatus = ref<'idle' | 'generating' | 'done' | 'failed'>('idle');
const genImageUrl = ref('');
const genErrorMsg = ref('');
const genHistory = ref<Array<{ url: string; prompt: string }>>([]);
const savingToAlbum = ref(false);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const userStore = useUserStore();

const genSuggestions = [
  { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7 16.2c2.2-1.2 4.8-1.2 6 0"/><circle cx="9" cy="9" r="1.5"/><circle cx="15" cy="9" r="1.5"/></svg>', prompt: '卡通小恐龙, 彩虹森林, 可爱动物们' },
  { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/><circle cx="8.5" cy="10" r="1" fill="currentColor" stroke="none"/></svg>', prompt: '可爱小猫, 在糖果花园里玩耍, 儿童插画' },
  { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M7 16.2c2.2-1.2 4.8-1.2 6 0"/><circle cx="9" cy="9" r="1.5"/><circle cx="15" cy="9" r="1.5"/></svg>', prompt: '卡通火箭, 飞向星星, 太空探险, 儿童绘本风格' },
  { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>', prompt: '可爱小鱼, 海底珊瑚, 彩色泡泡, 儿童插画' },
  { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>', prompt: '童话城堡, 彩虹独角兽, 棉花糖云朵, 卡通风格' },
  { icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><circle cx="8.5" cy="10" r="1.5"/><circle cx="15.5" cy="10" r="1.5"/></svg>', prompt: '春天樱花树下, 小朋友一起玩耍, 绘本故事风格' },
];

// ====== 手动绘画逻辑 ======
onMounted(() => {
  initCanvas();
});

function initCanvas() {
  if (!canvasRef.value) return;
  const canvas = canvasRef.value;
  const container = canvas.parentElement;
  if (!container) return;
  if (ctx.value && canvas.width > 0 && canvas.height > 0) return;
  canvas.width = container.clientWidth - 40;
  canvas.height = container.clientHeight - 40;
  ctx.value = canvas.getContext('2d');
  if (!ctx.value) return;
  ctx.value.lineCap = 'round';
  ctx.value.lineJoin = 'round';
  ctx.value.fillStyle = '#ffffff';
  ctx.value.fillRect(0, 0, canvas.width, canvas.height);
  saveState();
}

watch(activeMode, (mode) => {
  if (mode === 'draw') {
    nextTick(() => initCanvas());
  }
});

function getCanvasCoordinates(e: MouseEvent | Touch) {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  return { x, y };
}

function startDrawing(e: MouseEvent) {
  const coords = getCanvasCoordinates(e);
  if (!coords) return;
  isDrawing.value = true;
  [lastX, lastY] = [coords.x, coords.y];
}

function draw(e: MouseEvent) {
  if (!isDrawing.value || !ctx.value) return;
  const coords = getCanvasCoordinates(e);
  if (!coords) return;
  ctx.value.beginPath();
  ctx.value.moveTo(lastX, lastY);
  ctx.value.lineTo(coords.x, coords.y);
  ctx.value.strokeStyle = tool.value === 'eraser' ? '#ffffff' : color.value;
  ctx.value.lineWidth = brushSize.value;
  ctx.value.stroke();
  [lastX, lastY] = [coords.x, coords.y];
}

function stopDrawing() {
  if (isDrawing.value) {
    isDrawing.value = false;
    saveState();
  }
}

function handleTouchStart(e: TouchEvent) {
  e.preventDefault();
  const touch = e.touches[0];
  const coords = getCanvasCoordinates(touch);
  if (coords) {
    isDrawing.value = true;
    [lastX, lastY] = [coords.x, coords.y];
  }
}

function handleTouchMove(e: TouchEvent) {
  e.preventDefault();
  if (!isDrawing.value || !ctx.value) return;
  const touch = e.touches[0];
  const coords = getCanvasCoordinates(touch);
  if (!coords) return;
  ctx.value.beginPath();
  ctx.value.moveTo(lastX, lastY);
  ctx.value.lineTo(coords.x, coords.y);
  ctx.value.strokeStyle = tool.value === 'eraser' ? '#ffffff' : color.value;
  ctx.value.lineWidth = brushSize.value;
  ctx.value.stroke();
  [lastX, lastY] = [coords.x, coords.y];
}

function clearCanvas() {
  if (!ctx.value || !canvasRef.value) return;
  ctx.value.fillStyle = '#ffffff';
  ctx.value.fillRect(0, 0, canvasRef.value.width, canvasRef.value.height);
  saveState();
}

function saveState() {
  if (!ctx.value || !canvasRef.value) return;
  const imageData = ctx.value.getImageData(0, 0, canvasRef.value.width, canvasRef.value.height);
  history.value = history.value.slice(0, historyIndex.value + 1);
  history.value.push(imageData);
  historyIndex.value = history.value.length - 1;
}

function undo() {
  if (historyIndex.value > 0 && ctx.value && canvasRef.value) {
    historyIndex.value--;
    ctx.value.putImageData(history.value[historyIndex.value], 0, 0);
  }
}

function saveCanvas() {
  if (!canvasRef.value) return;
  const dataUrl = canvasRef.value.toDataURL();
  // 下载到本地
  const link = document.createElement('a');
  link.download = `drawing-${Date.now()}.png`;
  link.href = dataUrl;
  link.click();
  // 登录用户同步到设计相册
  saveDesignToAlbum(dataUrl);
}

async function saveDesignToAlbum(dataUrl: string) {
  const userId = userStore.userInfo?.id;
  if (!userId) return;
  try {
    await saveArtwork({
      userId,
      title: '自由绘画作品',
      imageUrl: dataUrl,
      sourceType: 'design',
    });
    message.success('已保存到设计相册');
  } catch { /* 静默，下载已触发 */ }
}

// ====== AI 生成逻辑 ======
async function handleGenerate() {
  const rawPrompt = genPrompt.value.trim();
  if (!rawPrompt || genStatus.value === 'generating') return;

  // 为孩子生成卡通童趣风格的画面
  const prompt = `儿童插画风格，可爱卡通，明亮温暖色彩，童趣十足，${rawPrompt}`;

  genStatus.value = 'generating';
  genImageUrl.value = '';
  genErrorMsg.value = '';

  try {
    const res = await submitImage(prompt);
    const taskId = res.data.id;

    // 开始轮询
    startPolling(taskId);
  } catch (error: any) {
    genStatus.value = 'failed';
    genErrorMsg.value = error?.response?.data?.message || '提交任务失败，请稍后再试';
    message.error('生成失败');
  }
}

function startPolling(taskId: string) {
  stopPolling();

  pollTimer = setInterval(async () => {
    try {
      const res = await queryImage(taskId);
      const result = res.data;

      if (result.status === 'succeeded' && result.results?.[0]?.url) {
        stopPolling();
        genImageUrl.value = result.results[0].url;
        genStatus.value = 'done';

        // 加入历史
        genHistory.value.unshift({
          url: result.results[0].url,
          prompt: genPrompt.value,
        });
        if (genHistory.value.length > 12) genHistory.value = genHistory.value.slice(0, 12);

        message.success('图片生成成功！');
      } else if (result.status === 'failed') {
        stopPolling();
        genStatus.value = 'failed';
        genErrorMsg.value = 'AI 暂时无法生成这张图片，请换个描述试试';
      }
    } catch {
      // 继续轮询
    }
  }, 2000);

  // 超时保护 (2 分钟)
  setTimeout(() => {
    if (genStatus.value === 'generating') {
      stopPolling();
      genStatus.value = 'failed';
      genErrorMsg.value = '生成超时，请重试';
    }
  }, 120000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function resetGen() {
  stopPolling();
  genStatus.value = 'idle';
  genImageUrl.value = '';
  genErrorMsg.value = '';
}

function regenerate() {
  resetGen();
  if (genPrompt.value.trim()) {
    setTimeout(() => handleGenerate(), 300);
  }
}

async function downloadGenImage() {
  if (!genImageUrl.value) return;
  try {
    const response = await fetch(genImageUrl.value);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `ai-drawing-${Date.now()}.png`;
    link.href = blobUrl;
    link.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(genImageUrl.value, '_blank');
  }
}

async function copyGenImage() {
  if (!genImageUrl.value) return;
  try {
    const response = await fetch(genImageUrl.value);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type]: blob }),
    ]);
    message.success('已复制到剪贴板');
  } catch {
    const url = genImageUrl.value;
    await navigator.clipboard.writeText(url);
    message.info('图片链接已复制');
  }
}

async function saveToAlbum() {
  if (!genImageUrl.value || savingToAlbum.value) return;

  savingToAlbum.value = true;
  const userId = userStore.userInfo?.id;

  if (!userId) {
    message.info('登录后可将作品保存到相册');
    savingToAlbum.value = false;
    return;
  }

  try {
    const res = await saveArtwork({
      userId,
      title: genPrompt.value || '我的画板作品',
      imageUrl: genImageUrl.value,
      sourceType: 'ai-art',
      prompt: genPrompt.value,
    });
    if (res.code === 0) {
      message.success('已保存到相册');
    } else {
      message.error(res.message || '保存失败，请稍后重试');
    }
  } catch {
    message.error('保存失败，请稍后重试');
  } finally {
    savingToAlbum.value = false;
  }
}

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<style scoped>
.draw-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #FFFBF5 0%, #FFF8F0 100%);
  color: #333;
}

/* 子导航（顶部品牌已迁移到全局 App.vue） */
.sub-header {
  background: rgba(255, 248, 240, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 140, 66, 0.08);
  padding: 12px 0;
}
.sub-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.back-btn {
  background: none;
  border: none;
  color: #666;
  font-size: 14px;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 8px;
  transition: all 0.2s;
}
.back-btn:hover {
  background: rgba(255, 140, 66, 0.08);
  color: #FF8C42;
}

/* 移动端专属：PC 端全局菜单可见时不需要返回按钮 */
@media (min-width: 769px) {
  .back-btn--mobile-only {
    display: none;
  }
}
.page-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

/* 模式切换 */
.mode-tabs {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 20px 20px 0;
  max-width: 1200px;
  margin: 0 auto;
}
.mode-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 28px;
  border: 1px solid rgba(255, 140, 66, 0.12);
  border-radius: 12px;
  background: #fff;
  color: #888;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}
.mode-tab:hover {
  border-color: rgba(255, 140, 66, 0.3);
  color: #FF8C42;
}
.mode-tab.active {
  background: rgba(255, 140, 66, 0.1);
  border-color: rgba(255, 140, 66, 0.35);
  color: #FF8C42;
  box-shadow: 0 0 20px rgba(255, 140, 66, 0.08);
}
.mode-icon {
  font-size: 18px;
}

/* ====== 自由绘画 ====== */
.canvas-wrapper {
  max-width: 1200px;
  margin: 20px auto;
  padding: 0 20px;
}
.toolbar {
  background: #fff;
  border: 1px solid rgba(255, 140, 66, 0.1);
  border-radius: 14px;
  padding: 16px 20px;
  margin-bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  box-shadow: 0 2px 12px rgba(255, 140, 66, 0.04);
}
.tool-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tool-group label {
  font-weight: 500;
  color: #888;
  font-size: 13px;
}
.color-picker {
  width: 40px;
  height: 32px;
  border: 1px solid rgba(255, 140, 66, 0.15);
  border-radius: 6px;
  cursor: pointer;
  background: #fff;
}
.color-presets {
  display: flex;
  gap: 4px;
}
.color-btn {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(255, 140, 66, 0.12);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
}
.color-btn:hover { transform: scale(1.15); }
.color-btn.active {
  border-color: #FF8C42;
  box-shadow: 0 0 8px rgba(255, 140, 66, 0.4);
}
.canvas-container {
  background: #fff;
  border-radius: 14px;
  padding: 20px;
  border: 1px solid rgba(255, 140, 66, 0.08);
  box-shadow: 0 2px 12px rgba(255, 140, 66, 0.04);
  height: calc(100vh - 250px);
  min-height: 450px;
}
canvas {
  width: 100%;
  height: 100%;
  border: 1px solid #f0e8e0;
  border-radius: 8px;
  cursor: crosshair;
}

/* ====== AI 生成 ====== */
.ai-gen-wrapper {
  max-width: 900px;
  margin: 16px auto 40px;
  padding: 0 20px;
}

/* 生成面板 */
.gen-panel {
  background: #fff;
  border: 1px solid rgba(255, 140, 66, 0.1);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 20px;
  box-shadow: 0 2px 12px rgba(255, 140, 66, 0.04);
}
.gen-header { text-align: center; margin-bottom: 20px; }
.gen-title {
  font-size: 22px;
  font-weight: 700;
  color: #333;
  margin: 0 0 8px;
}
.gen-desc {
  font-size: 14px;
  color: #888;
  margin: 0;
}

.gen-input-area { margin-bottom: 16px; }
.input-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.gen-input {
  flex: 1;
  background: #FFFBF5;
  border: 1px solid rgba(255, 140, 66, 0.12);
  border-radius: 14px;
  padding: 14px 18px;
  color: #333;
  font-size: 15px;
  font-family: inherit;
  resize: none;
  outline: none;
  transition: border-color 0.3s, box-shadow 0.3s;
  line-height: 1.5;
}
.gen-input:focus {
  border-color: rgba(255, 140, 66, 0.4);
  box-shadow: 0 0 0 3px rgba(255, 140, 66, 0.08);
}
.gen-input::placeholder { color: #bbb; }
.gen-input:disabled { opacity: 0.5; }

.gen-btn {
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #FF8C42, #FFB347);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
  flex-shrink: 0;
  box-shadow: 0 4px 18px rgba(255, 140, 66, 0.3);
}
.gen-btn:hover:not(.disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 24px rgba(255, 140, 66, 0.45);
}
.gen-btn.disabled {
  background: #f0e8e0;
  box-shadow: none;
  cursor: not-allowed;
  color: #ccc;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.gen-suggestions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.suggest-label {
  font-size: 13px;
  color: #888;
  margin-right: 4px;
}
.suggest-tag {
  padding: 6px 14px;
  background: #FFFBF5;
  border: 1px solid rgba(255, 140, 66, 0.08);
  border-radius: 20px;
  font-size: 13px;
  color: #888;
  cursor: pointer;
  transition: all 0.2s;
}
.suggest-tag:hover {
  border-color: rgba(255, 140, 66, 0.3);
  color: #FF8C42;
  background: rgba(255, 140, 66, 0.06);
}

/* 结果区域 */
.gen-result-area {
  background: #fff;
  border: 1px solid rgba(255, 140, 66, 0.1);
  border-radius: 16px;
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(255, 140, 66, 0.04);
}

.gen-placeholder {
  text-align: center;
  padding: 48px 20px;
}
.placeholder-icon { font-size: 56px; margin-bottom: 16px; color: #ddd; }
.gen-placeholder h3 {
  font-size: 18px;
  color: #888;
  margin: 0 0 8px;
}
.gen-placeholder p {
  font-size: 14px;
  color: #aaa;
  margin: 0;
}

/* 生成中 */
.gen-loading {
  text-align: center;
  padding: 48px 20px;
}
.loading-pulse {
  width: 64px;
  height: 64px;
  margin: 0 auto 20px;
  border-radius: 50%;
  background: rgba(255, 140, 66, 0.10);
  border: 2px solid rgba(255, 140, 66, 0.2);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.05); opacity: 1; }
}
.gen-loading h3 {
  font-size: 18px;
  color: #333;
  margin: 0 0 8px;
}
.loading-hint {
  font-size: 14px;
  color: #888;
  margin: 0 0 16px;
}
.loading-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
}
.ldot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #FF8C42;
  animation: dotBounce 1.4s infinite ease-in-out both;
}
.ldot:nth-child(1) { animation-delay: -0.32s; }
.ldot:nth-child(2) { animation-delay: -0.16s; }
@keyframes dotBounce {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.3; }
  40% { transform: scale(1); opacity: 1; }
}

/* 生成完成 */
.gen-done {
  width: 100%;
  padding: 24px;
  text-align: center;
}
.result-image-wrapper {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 16px;
  border: 1px solid rgba(255, 140, 66, 0.1);
}
.result-image {
  width: 100%;
  max-height: 500px;
  object-fit: contain;
  background: #FFFBF5;
  display: block;
}
.result-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  opacity: 0;
  transition: opacity 0.3s;
  backdrop-filter: blur(4px);
}
.result-image-wrapper:hover .result-overlay {
  opacity: 1;
}
.overlay-btn {
  padding: 10px 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.overlay-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.4);
}
.result-prompt {
  font-size: 14px;
  color: #888;
  margin: 0;
  font-style: italic;
}

.overlay-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.overlay-btn.primary {
  background: linear-gradient(135deg, #FF8C42, #FFB347);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 4px 16px rgba(255, 140, 66, 0.35);
}
.overlay-btn.primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 22px rgba(255, 140, 66, 0.5);
}
.spin {
  animation: spin 1s linear infinite;
}

/* 失败 */
.gen-error {
  text-align: center;
  padding: 48px 20px;
}
.error-icon { font-size: 48px; margin-bottom: 12px; color: #ddd; }
.gen-error h3 {
  font-size: 18px;
  color: #333;
  margin: 0 0 8px;
}
.gen-error p {
  font-size: 14px;
  color: #888;
  margin: 0 0 20px;
}

/* 历史记录 */
.gen-history { margin-top: 8px; }
.history-title {
  font-size: 16px;
  font-weight: 600;
  color: #666;
  margin: 0 0 12px;
}
.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.history-item {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 140, 66, 0.08);
  cursor: pointer;
  transition: all 0.3s;
  position: relative;
  background: #fff;
}
.history-item:hover {
  border-color: rgba(255, 140, 66, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(255, 140, 66, 0.08);
}
.history-thumb {
  width: 100%;
  height: 120px;
  object-fit: cover;
  display: block;
}
.history-info {
  padding: 8px 10px;
  background: #FFFBF5;
}
.history-prompt {
  font-size: 12px;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

/* 响应式 */
@media (max-width: 640px) {
  .mode-tabs { padding: 16px 12px 0; }
  .mode-tab { padding: 8px 18px; font-size: 14px; }
  .toolbar { padding: 12px 14px; }
  .gen-panel { padding: 16px; }
  .gen-input { font-size: 14px; }
  .history-grid { grid-template-columns: repeat(3, 1fr); }
}
</style>
