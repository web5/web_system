<template>
  <div class="create-page">
    <!-- 顶部栏 -->
    <header class="top-bar">
      <button class="back-btn" @click="goBack">← 返回</button>
      <span class="top-title">变变！ ✨</span>
      <button class="top-action" @click="handleTransform" :disabled="canvasElements.length === 0">
        变变
      </button>
    </header>

    <!-- 素材分类 Tab -->
    <div class="material-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >{{ tab.label }}</button>
    </div>

    <!-- 素材横向滚动列表 -->
    <div class="material-strip">
      <div class="material-list">
        <button
          v-for="item in filteredMaterials"
          :key="item.id"
          class="material-item"
          @click="addMaterial(item)"
        >
          <span class="material-emoji">{{ item.icon }}</span>
          <span class="material-label">{{ item.name }}</span>
        </button>
      </div>
    </div>

    <!-- 画布区 -->
    <div
      class="canvas-area"
      ref="canvasAreaRef"
      @touchstart="handleCanvasTouchStart"
      @touchmove="handleCanvasTouchMove"
      @touchend="handleCanvasTouchEnd"
      @mousedown="handleCanvasMouseDown"
      @mousemove="handleCanvasMouseMove"
      @mouseup="handleCanvasMouseUp"
    >
      <div class="canvas-inner" ref="canvasInnerRef">
        <!-- 素材元素 -->
        <div
          v-for="el in canvasElements"
          :key="el.id"
          class="canvas-element"
          :class="{ selected: selectedId === el.id }"
          :style="elementStyle(el)"
          @mousedown.stop="startDragElement($event, el)"
          @touchstart.stop="startDragElement($event, el)"
          @dblclick.stop="removeElement(el.id)"
        >
          <span class="element-content" :style="{ fontSize: el.fontSize + 'px' }">
            {{ el.content }}
          </span>
          <!-- 选中态 -->
          <div v-if="selectedId === el.id" class="element-handles">
            <div class="handle handle-tl" @mousedown.stop="startResize($event, el, 'tl')" @touchstart.stop="startResize($event, el, 'tl')"></div>
            <div class="handle handle-tr" @mousedown.stop="startResize($event, el, 'tr')" @touchstart.stop="startResize($event, el, 'tr')"></div>
            <div class="handle handle-bl" @mousedown.stop="startResize($event, el, 'bl')" @touchstart.stop="startResize($event, el, 'bl')"></div>
            <div class="handle handle-br" @mousedown.stop="startResize($event, el, 'br')" @touchstart.stop="startResize($event, el, 'br')"></div>
            <button class="handle-delete" @click.stop="removeElement(el.id)">×</button>
          </div>
        </div>

        <!-- 空画布提示 -->
        <div v-if="canvasElements.length === 0" class="canvas-empty">
          <span class="empty-icon">🎨</span>
          <p class="empty-text">拖拽素材或画一画～</p>
        </div>
      </div>
    </div>

    <!-- 描述输入 -->
    <div class="desc-area">
      <input
        v-model="description"
        class="desc-input"
        placeholder="描述一下你的作品？（选填）比如：我画了一只会飞的小鱼"
        maxlength="50"
      />
    </div>

    <!-- 底部操作栏 -->
    <div class="bottom-bar">
      <button class="bottom-btn btn-random" @click="addRandomMaterial">
        <span>🎲</span>
        <span>随机素材</span>
      </button>
      <button
        class="bottom-btn btn-transform"
        :class="{ disabled: canvasElements.length === 0 }"
        :disabled="canvasElements.length === 0"
        @click="handleTransform"
      >
        <span>变变！</span>
        <span>✨</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import request from '@/api/request';

const router = useRouter();

// ====== 素材库（从后端获取） ======
interface MaterialItem {
  id: string;
  category: string;
  name: string;
  icon: string;
  fontSize?: number;
}

const materials = ref<MaterialItem[]>([]);

async function loadMaterials() {
  try {
    const res = await request.get('/bianbian/materials');
    if (res.code === 0 && Array.isArray(res.data)) {
      materials.value = res.data.map((m: any) => ({
        ...m,
        fontSize: m.category === 'background' ? 200 : 48,
      }));
      return;
    }
  } catch { /* fallback below */ }
  // 接口不可用时使用内置后备素材
  materials.value = getFallbackMaterials();
}

function getFallbackMaterials(): MaterialItem[] {
  return [
    { id: 's1', category: 'sticker', name: '笑脸', icon: '😊', fontSize: 48 },
    { id: 's2', category: 'sticker', name: '小猫', icon: '🐱', fontSize: 48 },
    { id: 's3', category: 'sticker', name: '小狗', icon: '🐶', fontSize: 48 },
    { id: 's4', category: 'sticker', name: '兔子', icon: '🐰', fontSize: 48 },
    { id: 's5', category: 'sticker', name: '小熊', icon: '🐻', fontSize: 48 },
    { id: 's6', category: 'sticker', name: '熊猫', icon: '🐼', fontSize: 48 },
    { id: 's7', category: 'sticker', name: '星星', icon: '⭐', fontSize: 44 },
    { id: 's8', category: 'sticker', name: '彩虹', icon: '🌈', fontSize: 48 },
    { id: 's9', category: 'sticker', name: '月亮', icon: '🌙', fontSize: 44 },
    { id: 's10', category: 'sticker', name: '太阳', icon: '☀️', fontSize: 48 },
    { id: 's11', category: 'sticker', name: '云朵', icon: '☁️', fontSize: 44 },
    { id: 's12', category: 'sticker', name: '花花', icon: '🌸', fontSize: 44 },
    { id: 'sh1', category: 'shape', name: '爱心', icon: '❤️', fontSize: 44 },
    { id: 'sh2', category: 'shape', name: '圆形', icon: '🟠', fontSize: 44 },
    { id: 'sh3', category: 'shape', name: '钻石', icon: '💎', fontSize: 44 },
    { id: 'sh4', category: 'shape', name: '三角', icon: '🔺', fontSize: 44 },
    { id: 'bg1', category: 'background', name: '草地', icon: '🟢', fontSize: 200 },
    { id: 'bg2', category: 'background', name: '天空', icon: '🔵', fontSize: 200 },
    { id: 'bg3', category: 'background', name: '粉色', icon: '🩷', fontSize: 200 },
  ];
}

const tabs = [
  { key: 'all', label: '全部' },
  { key: 'sticker', label: '贴纸' },
  { key: 'shape', label: '形状' },
  { key: 'background', label: '背景' },
];

const activeTab = ref('all');
const filteredMaterials = computed(() => {
  const list = materials.value;
  return activeTab.value === 'all' ? list : list.filter((m) => m.category === activeTab.value);
});

// ====== 画布元素 ======
interface CanvasElement {
  id: string;
  content: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  fontSize: number;
}

const canvasElements = ref<CanvasElement[]>([]);
const selectedId = ref<string>('');
const description = ref('');
let elemCounter = 0;

function elementStyle(el: CanvasElement) {
  return {
    left: el.x + 'px',
    top: el.y + 'px',
    transform: `translate(-50%, -50%) scale(${el.scale}) rotate(${el.rotation}deg)`,
  };
}

function addMaterial(item: MaterialItem) {
  const el: CanvasElement = {
    id: `el_${++elemCounter}_${Date.now()}`,
    content: item.icon,
    x: 180 + Math.random() * 80 - 40,
    y: 220 + Math.random() * 60 - 30,
    scale: 1,
    rotation: 0,
    fontSize: item.fontSize || 48,
  };
  canvasElements.value.push(el);
  selectedId.value = el.id;
  saveDraft();
}

function addRandomMaterial() {
  const list = materials.value;
  if (list.length === 0) return;
  const random = list[Math.floor(Math.random() * list.length)];
  addMaterial(random);
}

function removeElement(id: string) {
  canvasElements.value = canvasElements.value.filter((e) => e.id !== id);
  if (selectedId.value === id) selectedId.value = '';
  saveDraft();
}

// ====== 拖拽 ======
const canvasAreaRef = ref<HTMLElement | null>(null);
const canvasInnerRef = ref<HTMLElement | null>(null);
let dragging: CanvasElement | null = null;
let resizing: CanvasElement | null = null;
let resizeCorner: string = '';
let dragStartX = 0;
let dragStartY = 0;
let elemStartX = 0;
let elemStartY = 0;
let elemStartScale = 1;

function startDragElement(e: MouseEvent | TouchEvent, el: CanvasElement) {
  selectedId.value = el.id;
  dragging = el;
  const pos = getEventPos(e);
  dragStartX = pos.x;
  dragStartY = pos.y;
  elemStartX = el.x;
  elemStartY = el.y;
  e.preventDefault();
}

function startResize(e: MouseEvent | TouchEvent, el: CanvasElement, corner: string) {
  resizing = el;
  resizeCorner = corner;
  elemStartScale = el.scale;
  const pos = getEventPos(e);
  dragStartX = pos.x;
  dragStartY = pos.y;
  e.preventDefault();
  e.stopPropagation();
}

function getEventPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
  if ('touches' in e) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

function handleCanvasMouseDown(e: MouseEvent) {
  if (e.target === canvasAreaRef.value || (e.target as HTMLElement)?.classList.contains('canvas-inner')) {
    selectedId.value = '';
  }
}

function handleCanvasMouseMove(e: MouseEvent) {
  if (dragging) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    const rect = canvasAreaRef.value?.getBoundingClientRect();
    const maxW = rect ? rect.width - 30 : 400;
    const maxH = rect ? rect.height - 30 : 400;
    dragging.x = Math.max(0, Math.min(maxW, elemStartX + dx));
    dragging.y = Math.max(0, Math.min(maxH, elemStartY + dy));
    return;
  }
  if (resizing) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const delta = (dy >= 0 ? dist : -dist) * 0.003;
    resizing.scale = Math.max(0.3, Math.min(3, elemStartScale + delta));
  }
}

function handleCanvasMouseUp() {
  if (dragging) {
    saveDraft();
    dragging = null;
  }
  if (resizing) {
    saveDraft();
    resizing = null;
  }
}

function handleCanvasTouchStart(e: TouchEvent) {
  if ((e.target as HTMLElement)?.closest('.canvas-element')) return;
  selectedId.value = '';
}

function handleCanvasTouchMove(e: TouchEvent) {
  if (dragging && e.touches.length === 1) {
    const dx = e.touches[0].clientX - dragStartX;
    const dy = e.touches[0].clientY - dragStartY;
    const rect = canvasAreaRef.value?.getBoundingClientRect();
    const maxW = rect ? rect.width - 30 : 400;
    const maxH = rect ? rect.height - 30 : 400;
    dragging.x = Math.max(0, Math.min(maxW, elemStartX + dx));
    dragging.y = Math.max(0, Math.min(maxH, elemStartY + dy));
    return;
  }
  if (resizing && e.touches.length === 1) {
    const dx = e.touches[0].clientX - dragStartX;
    const dy = e.touches[0].clientY - dragStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const delta = (dy >= 0 ? dist : -dist) * 0.003;
    resizing.scale = Math.max(0.3, Math.min(3, elemStartScale + delta));
  }
}

function handleCanvasTouchEnd() {
  handleCanvasMouseUp();
}

// ====== 草稿 ======
function saveDraft() {
  try {
    localStorage.setItem('bb_draft', JSON.stringify({
      elements: canvasElements.value.map((e) => ({ ...e })),
      description: description.value,
      savedAt: new Date().toISOString(),
    }));
  } catch { /* ignore */ }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem('bb_draft');
    if (raw) {
      const draft = JSON.parse(raw);
      if (draft.elements?.length) {
        canvasElements.value = draft.elements;
        description.value = draft.description || '';
        elemCounter = canvasElements.value.length;
        return true;
      }
    }
  } catch { /* ignore */ }
  return false;
}

// ====== 导航 ======
function goBack() {
  saveDraft();
  router.push('/');
}

function handleTransform() {
  if (canvasElements.value.length === 0) return;
  saveDraft();

  // 传递画布数据到变身页
  const data = {
    elements: canvasElements.value,
    description: description.value,
  };
  localStorage.setItem('bb_transform_data', JSON.stringify(data));
  router.push('/bianbian/transform');
}

onMounted(async () => {
  await loadMaterials();
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('resume') === '1') {
    loadDraft();
  }
  // 自动保存草稿
  window.addEventListener('beforeunload', saveDraft);
});

onBeforeUnmount(() => {
  saveDraft();
  window.removeEventListener('beforeunload', saveDraft);
});
</script>

<style scoped>
.create-page {
  height: 100vh;
  height: 100dvh;
  background: #FFF8F0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 顶部栏 */
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  padding-top: max(12px, env(safe-area-inset-top));
  background: rgba(255, 248, 240, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 140, 66, 0.08);
  flex-shrink: 0;
}

.back-btn {
  border: none;
  background: none;
  color: #FF8C42;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  padding: 8px 4px;
}

.top-title {
  font-size: 18px;
  font-weight: 700;
  color: #333;
}

.top-action {
  border: none;
  background: linear-gradient(135deg, #FF8C42, #FFB347);
  color: #fff;
  padding: 8px 20px;
  border-radius: 16px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 4px 16px rgba(255, 140, 66, 0.25);
}

.top-action:active:not(:disabled) {
  transform: scale(0.95);
}

.top-action:disabled {
  opacity: 0.4;
  box-shadow: none;
}

/* 素材 Tab */
.material-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 16px 8px;
  overflow-x: auto;
  flex-shrink: 0;
  -webkit-overflow-scrolling: touch;
}

.material-tabs::-webkit-scrollbar { display: none; }

.tab-btn {
  padding: 8px 18px;
  border: none;
  border-radius: 20px;
  background: rgba(255, 140, 66, 0.06);
  color: #888;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
  flex-shrink: 0;
}

.tab-btn.active {
  background: #FF8C42;
  color: #fff;
  box-shadow: 0 2px 8px rgba(255, 140, 66, 0.25);
}

/* 素材列表 */
.material-strip {
  padding: 4px 16px 8px;
  overflow-x: auto;
  flex-shrink: 0;
  -webkit-overflow-scrolling: touch;
}

.material-strip::-webkit-scrollbar { display: none; }

.material-list {
  display: flex;
  gap: 8px;
}

.material-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 12px;
  border: 1.5px solid rgba(255, 140, 66, 0.08);
  border-radius: 16px;
  background: #fff;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
  min-width: 56px;
}

.material-item:active {
  background: #FFF3E8;
  border-color: rgba(255, 140, 66, 0.3);
  transform: scale(0.95);
}

.material-emoji {
  font-size: 32px;
  line-height: 1;
}

.material-label {
  font-size: 11px;
  color: #888;
}

/* 画布区 */
.canvas-area {
  flex: 1;
  margin: 8px 16px;
  background: #fff;
  border: 2px dashed rgba(255, 140, 66, 0.12);
  border-radius: 20px;
  position: relative;
  overflow: hidden;
  touch-action: none;
}

.canvas-inner {
  width: 100%;
  height: 100%;
  position: relative;
}

.canvas-element {
  position: absolute;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  transition: box-shadow 0.15s;
}

.canvas-element.selected {
  z-index: 10;
}

.element-content {
  display: block;
  line-height: 1;
  pointer-events: none;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
}

/* 选中手柄 */
.element-handles {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.canvas-element.selected::before {
  content: '';
  position: absolute;
  top: -6px;
  left: -6px;
  right: -6px;
  bottom: -6px;
  border: 2px solid #4ECDC4;
  border-radius: 8px;
  pointer-events: none;
}

.handle {
  width: 12px;
  height: 12px;
  background: #4ECDC4;
  border: 2px solid #fff;
  border-radius: 50%;
  position: absolute;
  pointer-events: auto;
}

.handle-tl { top: -8px; left: -8px; cursor: nw-resize; }
.handle-tr { top: -8px; right: -8px; cursor: ne-resize; }
.handle-bl { bottom: -8px; left: -8px; cursor: sw-resize; }
.handle-br { bottom: -8px; right: -8px; cursor: se-resize; }

.handle-delete {
  position: absolute;
  top: -12px;
  right: -12px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid #fff;
  background: #ff4757;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}

/* 空画布 */
.canvas-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}

.empty-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 8px;
  opacity: 0.6;
}

.empty-text {
  font-size: 15px;
  color: #bbb;
  margin: 0;
}

/* 描述输入 */
.desc-area {
  padding: 0 16px 8px;
  flex-shrink: 0;
}

.desc-input {
  width: 100%;
  padding: 12px 16px;
  border: 1.5px solid rgba(255, 140, 66, 0.12);
  border-radius: 14px;
  font-size: 14px;
  color: #333;
  background: #fff;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.desc-input:focus {
  border-color: #FF8C42;
}

.desc-input::placeholder {
  color: #ccc;
}

/* 底部操作栏 */
.bottom-bar {
  display: flex;
  gap: 10px;
  padding: 8px 16px;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  background: rgba(255, 248, 240, 0.95);
  backdrop-filter: blur(12px);
  border-top: 1px solid rgba(255, 140, 66, 0.08);
  flex-shrink: 0;
}

.bottom-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 20px;
  border: none;
  border-radius: 18px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.bottom-btn:active {
  transform: scale(0.96);
}

.btn-random {
  flex-shrink: 0;
  background: #fff;
  color: #FF8C42;
  border: 1.5px solid rgba(255, 140, 66, 0.15);
}

.btn-random:active {
  background: #FFF3E8;
}

.btn-transform {
  flex: 1;
  background: linear-gradient(135deg, #FF8C42, #FFB347);
  color: #fff;
  box-shadow: 0 6px 24px rgba(255, 140, 66, 0.3);
  animation: btnGlow 2s ease-in-out infinite;
}

@keyframes btnGlow {
  0%, 100% { box-shadow: 0 6px 24px rgba(255, 140, 66, 0.3); }
  50% { box-shadow: 0 8px 32px rgba(255, 140, 66, 0.45); }
}

.btn-transform.disabled {
  background: #e0e0e0;
  color: #aaa;
  box-shadow: none;
  animation: none;
  cursor: not-allowed;
}

/* 响应式 */
@media (min-width: 768px) {
  .create-page {
    max-width: 480px;
    margin: 0 auto;
    border-left: 1px solid rgba(255, 140, 66, 0.08);
    border-right: 1px solid rgba(255, 140, 66, 0.08);
  }
}
</style>
