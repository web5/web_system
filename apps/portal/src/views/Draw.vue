<template>
  <div class="draw-page">
    <!-- 导航栏 -->
    <nav class="navbar">
      <div class="nav-content">
        <div class="logo">
          <router-link to="/" class="logo-link">
            <h1>🎨 科豆 AI</h1>
          </router-link>
        </div>
        <div class="nav-links">
          <router-link to="/" class="nav-link">首页</router-link>
          <router-link to="/draw" class="nav-link active">画笔</router-link>
        </div>
      </div>
    </nav>

    <!-- 画板区域 -->
    <div class="canvas-wrapper">
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const ctx = ref<CanvasRenderingContext2D | null>(null);
const isDrawing = ref(false);
const tool = ref('brush');
const color = ref('#667eea');
const brushSize = ref(5);
const history = ref<ImageData[]>([]);
const historyIndex = ref(-1);

const colorPresets = ['#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe', '#43e97b', '#fa709a', '#fee140', '#000000', '#ffffff'];

let lastX = 0;
let lastY = 0;

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

onBeforeUnmount(() => {
  // 清理
});
</script>

<style scoped>
.draw-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.navbar {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  padding: 15px 0;
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
}

.logo h1 {
  font-size: 24px;
  color: #667eea;
  margin: 0;
}

.nav-links {
  display: flex;
  gap: 30px;
}

.nav-link {
  text-decoration: none;
  color: #333;
  font-weight: 500;
  transition: color 0.3s;
}

.nav-link:hover,
.nav-link.active {
  color: #667eea;
}

.canvas-wrapper {
  max-width: 1200px;
  margin: 30px auto;
  padding: 0 20px;
}

.toolbar {
  background: white;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  align-items: center;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tool-group label {
  font-weight: 500;
  color: #333;
}

.color-picker {
  width: 50px;
  height: 35px;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}

.color-presets {
  display: flex;
  gap: 5px;
}

.color-btn {
  width: 25px;
  height: 25px;
  border: 2px solid #ddd;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.2s, border-color 0.2s;
}

.color-btn:hover {
  transform: scale(1.1);
}

.color-btn.active {
  border-color: #667eea;
  box-shadow: 0 0 5px rgba(102, 126, 234, 0.5);
}

.canvas-container {
  background: white;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  height: calc(100vh - 250px);
  min-height: 500px;
}

canvas {
  width: 100%;
  height: 100%;
  border: 1px solid #eee;
  border-radius: 8px;
  cursor: crosshair;
}
</style>
