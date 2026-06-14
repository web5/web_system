<template>
  <div class="draw-page">
    <!-- 导航栏 -->
    <nav class="navbar">
      <div class="nav-content">
        <div class="logo">
          <router-link to="/" class="logo-link">
            <img src="/logo.svg" alt="科豆 AI" class="nav-logo" width="32" height="17" />
            <h1>科豆 AI</h1>
          </router-link>
        </div>
        <div class="nav-links">
          <router-link to="/" class="nav-link">首页</router-link>
          <router-link to="/chat" class="nav-link">AI 助手</router-link>
          <router-link to="/draw" class="nav-link active">画笔</router-link>
        </div>
      </div>
    </nav>

    <!-- 模式切换 -->
    <div class="mode-tabs">
      <button
        class="mode-tab"
        :class="{ active: activeMode === 'draw' }"
        @click="activeMode = 'draw'"
      >
        <span class="mode-icon">✏️</span>
        <span>自由绘画</span>
      </button>
      <button
        class="mode-tab"
        :class="{ active: activeMode === 'ai' }"
        @click="activeMode = 'ai'"
      >
        <span class="mode-icon">✨</span>
        <span>AI 生成</span>
      </button>
    </div>

    <!-- ====== 自由绘画模式 ====== -->
    <div v-if="activeMode === 'draw'" class="canvas-wrapper">
      <div class="toolbar">
        <div class="tool-group">
          <label>工具：</label>
          <a-radio-group v-model:value="tool" button-style="solid">
            <a-radio-button value="brush">🖌️ 画笔</a-radio-button>
            <a-radio-button value="eraser">🧹 橡皮</a-radio-button>
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
          <a-button @click="clearCanvas">🗑️ 清空</a-button>
          <a-button @click="undo">↩️ 撤销</a-button>
          <a-button @click="saveCanvas" type="primary">💾 保存</a-button>
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
          >{{ item.emoji }} {{ item.prompt }}</button>
        </div>
      </div>

      <!-- 生成结果区 -->
      <div class="gen-result-area">
        <!-- 状态：空闲 -->
        <div v-if="genStatus === 'idle' && !genImageUrl" class="gen-placeholder">
          <div class="placeholder-icon">🎨</div>
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
              <button class="overlay-btn" @click="downloadGenImage" title="下载图片">💾 下载</button>
              <button class="overlay-btn" @click="copyGenImage" title="复制图片">📋 复制</button>
              <button class="overlay-btn" @click="regenerate" title="重新生成">🔄 重试</button>
            </div>
          </div>
          <p class="result-prompt">「{{ genPrompt }}」</p>
        </div>

        <!-- 状态：失败 -->
        <div v-if="genStatus === 'failed'" class="gen-error">
          <div class="error-icon">😢</div>
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
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { message } from 'ant-design-vue';
import { submitImage, queryImage } from '@/api/ai';

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
let pollTimer: ReturnType<typeof setInterval> | null = null;

const genSuggestions = [
  { emoji: '🌧️', prompt: '雨中, 竹林, 小路' },
  { emoji: '🐱', prompt: '阳光下的小猫在花园里玩耍' },
  { emoji: '🚀', prompt: '太空探险, 火箭, 星球' },
  { emoji: '🌊', prompt: '海底世界, 珊瑚, 鱼群' },
  { emoji: '🏰', prompt: '童话城堡, 彩虹, 独角兽' },
  { emoji: '🌸', prompt: '春天樱花树下的小朋友' },
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

function startDrawing(e: MouseEvent) {
  isDrawing.value = true;
  [lastX, lastY] = [e.offsetX, e.offsetY];
}

function draw(e: MouseEvent) {
  if (!isDrawing.value || !ctx.value) return;
  ctx.value.beginPath();
  ctx.value.moveTo(lastX, lastY);
  ctx.value.lineTo(e.offsetX, e.offsetY);
  ctx.value.strokeStyle = tool.value === 'eraser' ? '#ffffff' : color.value;
  ctx.value.lineWidth = brushSize.value;
  ctx.value.stroke();
  [lastX, lastY] = [e.offsetX, e.offsetY];
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
  const rect = canvasRef.value?.getBoundingClientRect();
  if (rect) {
    isDrawing.value = true;
    [lastX, lastY] = [touch.clientX - rect.left, touch.clientY - rect.top];
  }
}

function handleTouchMove(e: TouchEvent) {
  e.preventDefault();
  if (!isDrawing.value || !ctx.value) return;
  const touch = e.touches[0];
  const rect = canvasRef.value?.getBoundingClientRect();
  if (rect) {
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    ctx.value.beginPath();
    ctx.value.moveTo(lastX, lastY);
    ctx.value.lineTo(x, y);
    ctx.value.strokeStyle = tool.value === 'eraser' ? '#ffffff' : color.value;
    ctx.value.lineWidth = brushSize.value;
    ctx.value.stroke();
    [lastX, lastY] = [x, y];
  }
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
  const link = document.createElement('a');
  link.download = `drawing-${Date.now()}.png`;
  link.href = canvasRef.value.toDataURL();
  link.click();
}

// ====== AI 生成逻辑 ======
async function handleGenerate() {
  const prompt = genPrompt.value.trim();
  if (!prompt || genStatus.value === 'generating') return;

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

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<style scoped>
.draw-page {
  min-height: 100vh;
  background: #0a0a0d;
}

/* 导航栏 */
.navbar {
  background: rgba(12, 12, 13, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(249, 115, 22, 0.08);
  padding: 12px 0;
}
.nav-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.logo-link {
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 10px;
}
.nav-logo {
  flex-shrink: 0;
  border-radius: 6px;
}
.logo h1 {
  font-size: 20px;
  color: #f97316;
  margin: 0;
}
.nav-links {
  display: flex;
  gap: 24px;
}
.nav-link {
  text-decoration: none;
  color: #94a3b8;
  font-weight: 500;
  font-size: 14px;
  transition: color 0.2s;
}
.nav-link:hover,
.nav-link.active {
  color: #f97316;
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
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.02);
  color: #94a3b8;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}
.mode-tab:hover {
  border-color: rgba(249, 115, 22, 0.25);
  color: #f97316;
}
.mode-tab.active {
  background: rgba(249, 115, 22, 0.12);
  border-color: rgba(249, 115, 22, 0.35);
  color: #f97316;
  box-shadow: 0 0 20px rgba(249, 115, 22, 0.08);
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
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  padding: 16px 20px;
  margin-bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}
.tool-group {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tool-group label {
  font-weight: 500;
  color: #94a3b8;
  font-size: 13px;
}
.color-picker {
  width: 40px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
}
.color-presets {
  display: flex;
  gap: 4px;
}
.color-btn {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
}
.color-btn:hover { transform: scale(1.15); }
.color-btn.active {
  border-color: #f97316;
  box-shadow: 0 0 8px rgba(249, 115, 22, 0.4);
}
.canvas-container {
  background: #fff;
  border-radius: 14px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  height: calc(100vh - 250px);
  min-height: 450px;
}
canvas {
  width: 100%;
  height: 100%;
  border: 1px solid #eee;
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
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 20px;
}
.gen-header { text-align: center; margin-bottom: 20px; }
.gen-title {
  font-size: 22px;
  font-weight: 700;
  color: #f8fafc;
  margin: 0 0 8px;
}
.gen-desc {
  font-size: 14px;
  color: #64748b;
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
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 14px 18px;
  color: #f8fafc;
  font-size: 15px;
  font-family: inherit;
  resize: none;
  outline: none;
  transition: border-color 0.3s, box-shadow 0.3s;
  line-height: 1.5;
}
.gen-input:focus {
  border-color: rgba(249, 115, 22, 0.4);
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.06);
}
.gen-input::placeholder { color: #475569; }
.gen-input:disabled { opacity: 0.5; }

.gen-btn {
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, #f97316, #ea580c);
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s;
  flex-shrink: 0;
  box-shadow: 0 4px 18px rgba(249, 115, 22, 0.3);
}
.gen-btn:hover:not(.disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 24px rgba(249, 115, 22, 0.45);
}
.gen-btn.disabled {
  background: rgba(255, 255, 255, 0.06);
  box-shadow: none;
  cursor: not-allowed;
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
  color: #64748b;
  margin-right: 4px;
}
.suggest-tag {
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 20px;
  font-size: 13px;
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.2s;
}
.suggest-tag:hover {
  border-color: rgba(249, 115, 22, 0.3);
  color: #f97316;
  background: rgba(249, 115, 22, 0.06);
}

/* 结果区域 */
.gen-result-area {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  overflow: hidden;
}

.gen-placeholder {
  text-align: center;
  padding: 48px 20px;
}
.placeholder-icon { font-size: 56px; margin-bottom: 16px; }
.gen-placeholder h3 {
  font-size: 18px;
  color: #94a3b8;
  margin: 0 0 8px;
}
.gen-placeholder p {
  font-size: 14px;
  color: #64748b;
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
  background: rgba(249, 115, 22, 0.10);
  border: 2px solid rgba(249, 115, 22, 0.2);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.05); opacity: 1; }
}
.gen-loading h3 {
  font-size: 18px;
  color: #f8fafc;
  margin: 0 0 8px;
}
.loading-hint {
  font-size: 14px;
  color: #64748b;
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
  background: #f97316;
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
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.result-image {
  width: 100%;
  max-height: 500px;
  object-fit: contain;
  background: #0a0a0d;
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
  color: #94a3b8;
  margin: 0;
  font-style: italic;
}

/* 失败 */
.gen-error {
  text-align: center;
  padding: 48px 20px;
}
.error-icon { font-size: 48px; margin-bottom: 12px; }
.gen-error h3 {
  font-size: 18px;
  color: #f8fafc;
  margin: 0 0 8px;
}
.gen-error p {
  font-size: 14px;
  color: #64748b;
  margin: 0 0 20px;
}

/* 历史记录 */
.gen-history { margin-top: 8px; }
.history-title {
  font-size: 16px;
  font-weight: 600;
  color: #e2e8f0;
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
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transition: all 0.3s;
  position: relative;
}
.history-item:hover {
  border-color: rgba(249, 115, 22, 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.history-thumb {
  width: 100%;
  height: 120px;
  object-fit: cover;
  display: block;
}
.history-info {
  padding: 8px 10px;
  background: rgba(12, 12, 13, 0.9);
}
.history-prompt {
  font-size: 12px;
  color: #94a3b8;
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
