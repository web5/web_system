<template>
  <div class="create-page">
    <!-- 子页面顶部栏（顶部品牌由全局 AppNavbar 提供） -->
    <header class="top-bar">
      <button class="back-btn back-btn--mobile-only" @click="goBack">← 返回</button>
      <span class="top-title">开始创作
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-left:2px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </span>
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
          :class="{ 'is-dragging': dragItemId === item.id }"
          draggable="true"
          @click="addMaterial(item)"
          @dragstart="onMaterialDragStart($event, item)"
          @dragend="onMaterialDragEnd"
          @touchstart="onMaterialTouchStart($event, item)"
        >
          <!-- SVG 素材 -->
          <img v-if="item.type === 'svg'" :src="item.content" :alt="item.name" class="material-svg-img" />
          <!-- emoji 素材（后备） -->
          <span v-else-if="item.type === 'emoji'" class="material-emoji">{{ item.content }}</span>
          <!-- 颜色背景素材 -->
          <span v-else-if="item.type === 'color'" class="material-color-swatch" :style="{ background: item.content }"></span>
          <span class="material-label">{{ item.name }}</span>
        </button>
      </div>
    </div>

    <!-- 画布区 -->
    <div
      class="canvas-area"
      ref="canvasAreaRef"
      :class="{ 'drag-over': isCanvasDragOver }"
      @touchstart="handleCanvasTouchStart"
      @touchmove="handleCanvasTouchMove"
      @touchend="handleCanvasTouchEnd"
      @mousedown="handleCanvasMouseDown"
      @mousemove="handleCanvasMouseMove"
      @mouseup="handleCanvasMouseUp"
      @dragover.prevent="onCanvasDragOver"
      @dragenter.prevent="onCanvasDragEnter"
      @dragleave="onCanvasDragLeave"
      @drop="onCanvasDrop"
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
          <!-- SVG 素材（<img> 加载） -->
          <img v-if="el.type === 'svg'" :src="el.content" :alt="''" class="element-svg" :style="{ width: el.fontSize + 'px', height: el.fontSize + 'px' }" />
          <!-- 颜色背景 -->
          <div v-else-if="el.type === 'color'" class="element-bg" :style="{ background: el.content }"></div>
          <!-- emoji 素材（后备） -->
          <span v-else class="element-content" :style="{ fontSize: el.fontSize + 'px' }">
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
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
          </div>
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="1" width="7" height="7" rx="1"/><rect x="15" y="1" width="7" height="7" rx="1"/><rect x="2" y="16" width="7" height="7" rx="1"/><rect x="15" y="16" width="7" height="7" rx="1"/></svg>
        <span>随机素材</span>
      </button>
      <button
        class="bottom-btn btn-transform"
        :class="{ disabled: canvasElements.length === 0 }"
        :disabled="canvasElements.length === 0"
        @click="handleTransform"
      >
        <span>变变！</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import request from '@/api/request';
import type { MaterialItem, CanvasElement } from '@/types/material';
import { ALL_MATERIALS, MATERIAL_TABS } from '@/config/materials';

const router = useRouter();

// ====== 素材库 ======
const materials = ref<MaterialItem[]>([]);

async function loadMaterials() {
  try {
    const res = await request.get('/bianbian/materials');
    if (res.code === 0 && Array.isArray(res.data)) {
      // 将后端素材映射为前端统一格式（支持 emoji 和 color 类型）
      materials.value = res.data.map((m: any) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        type: (m.type === 'svg' || m.type === 'color') ? m.type : 'emoji',
        content: m.type === 'color' ? m.content : (m.icon || m.content),
      }));
      return;
    }
  } catch { /* fallback below */ }
  // 接口不可用时使用内置 SVG 素材
  materials.value = ALL_MATERIALS;
}

// ====== 分类 Tab ======
const tabs = MATERIAL_TABS;
const activeTab = ref('all');
const filteredMaterials = computed(() => {
  const list = materials.value;
  if (activeTab.value === 'all') return list;
  return list.filter((m) => m.category === activeTab.value);
});

// ====== 画布元素 ======
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
  const isBg = item.type === 'color';
  const el: CanvasElement = {
    id: `el_${++elemCounter}_${Date.now()}`,
    content: item.content,
    type: item.type,
    x: isBg ? 0 : 180 + Math.random() * 80 - 40,
    y: isBg ? 0 : 220 + Math.random() * 60 - 30,
    scale: 1,
    rotation: 0,
    fontSize: isBg ? 400 : 64,
  };

  // 背景素材：替换已有背景或添加到底层
  if (isBg) {
    const existingBg = canvasElements.value.find(e => e.type === 'color');
    if (existingBg) {
      existingBg.content = el.content;
      saveDraft();
      return;
    }
    // 插入到最底层
    canvasElements.value.unshift(el);
  } else {
    canvasElements.value.push(el);
  }
  selectedId.value = el.id;
  saveDraft();
}

function addRandomMaterial() {
  const list = materials.value;
  if (list.length === 0) return;
  const random = list[Math.floor(Math.random() * list.length)];
  addMaterial(random);
}

// ====== 素材拖拽到画布 ======

// --- 状态 ---
const isCanvasDragOver = ref(false);
const dragItemId = ref<string | null>(null);

// --- HTML5 拖拽（桌面端） ---
function onMaterialDragStart(e: DragEvent, item: MaterialItem) {
  if (!e.dataTransfer) return;
  dragItemId.value = item.id;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('application/json', JSON.stringify({
    id: item.id,
    name: item.name,
    type: item.type,
    content: item.content,
    category: item.category,
  }));
  // 设置拖拽预览图为素材缩略图
  const el = e.target as HTMLElement;
  const img = el.querySelector('img');
  if (img && e.dataTransfer.setDragImage) {
    e.dataTransfer.setDragImage(img, 18, 18);
  }
}

function onMaterialDragEnd() {
  dragItemId.value = null;
}

function onCanvasDragOver(e: DragEvent) {
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy';
  }
}

function onCanvasDragEnter(_e: DragEvent) {
  isCanvasDragOver.value = true;
}

function onCanvasDragLeave(e: DragEvent) {
  // 只在真正离开画布时取消高亮（避免子元素触发）
  const rect = canvasAreaRef.value?.getBoundingClientRect();
  if (rect) {
    const { clientX, clientY } = e;
    if (
      clientX <= rect.left ||
      clientX >= rect.right ||
      clientY <= rect.top ||
      clientY >= rect.bottom
    ) {
      isCanvasDragOver.value = false;
    }
  }
}

function onCanvasDrop(e: DragEvent) {
  isCanvasDragOver.value = false;
  if (!e.dataTransfer) return;
  const json = e.dataTransfer.getData('application/json');
  if (!json) return;
  try {
    const item: MaterialItem = JSON.parse(json);
    dropMaterialAtPosition(item, e.clientX, e.clientY);
  } catch { /* ignore malformed data */ }
}

// --- 触摸拖拽（移动端） ---
let touchDragItem: MaterialItem | null = null;
let touchGhostEl: HTMLElement | null = null;
let touchStartX = 0;
let touchStartY = 0;
let touchMoved = false;

function onMaterialTouchStart(e: TouchEvent, item: MaterialItem) {
  const touch = e.touches[0];
  touchDragItem = item;
  touchMoved = false;
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;

  // 创建跟随手指的"幽灵"元素
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.style.left = touch.clientX + 'px';
  ghost.style.top = touch.clientY + 'px';

  if (item.type === 'svg') {
    const img = document.createElement('img');
    img.src = item.content;
    img.style.width = '48px';
    img.style.height = '48px';
    img.style.objectFit = 'contain';
    ghost.appendChild(img);
  } else if (item.type === 'color') {
    const swatch = document.createElement('span');
    swatch.style.cssText = `display:block;width:48px;height:48px;border-radius:10px;background:${item.content};border:2px solid rgba(0,0,0,0.08);`;
    ghost.appendChild(swatch);
  } else {
    ghost.textContent = item.content;
    ghost.style.fontSize = '40px';
    ghost.style.lineHeight = '1';
  }

  document.body.appendChild(ghost);
  touchGhostEl = ghost;

  document.addEventListener('touchmove', onTouchDragMove, { passive: false });
  document.addEventListener('touchend', onTouchDragEnd);
  document.addEventListener('touchcancel', onTouchDragEnd);

  e.preventDefault();
}

function onTouchDragMove(e: TouchEvent) {
  e.preventDefault();
  if (!touchGhostEl) return;
  const touch = e.touches[0];
  touchGhostEl.style.left = touch.clientX + 'px';
  touchGhostEl.style.top = touch.clientY + 'px';

  // 判断移动是否超过阈值，用于区分拖拽和点击
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
    touchMoved = true;
    dragItemId.value = touchDragItem?.id || null;
  }

  // 高亮画布
  const canvasRect = canvasAreaRef.value?.getBoundingClientRect();
  if (canvasRect) {
    isCanvasDragOver.value = isPointInRect(touch.clientX, touch.clientY, canvasRect);
  }
}

function onTouchDragEnd(e: TouchEvent) {
  document.removeEventListener('touchmove', onTouchDragMove);
  document.removeEventListener('touchend', onTouchDragEnd);
  document.removeEventListener('touchcancel', onTouchDragEnd);

  const touch = e.changedTouches[0];

  // 如果手指在画布区域内，放下素材
  const canvasRect = canvasAreaRef.value?.getBoundingClientRect();
  if (canvasRect && touchDragItem && isPointInRect(touch.clientX, touch.clientY, canvasRect)) {
    dropMaterialAtPosition(touchDragItem, touch.clientX, touch.clientY);
  }

  // 清理
  cleanupTouchDrag();
}

function cleanupTouchDrag() {
  if (touchGhostEl) {
    touchGhostEl.remove();
    touchGhostEl = null;
  }
  touchDragItem = null;
  isCanvasDragOver.value = false;
  dragItemId.value = null;
}

// --- 通用：在指定屏幕坐标放置素材 ---
function dropMaterialAtPosition(item: MaterialItem, screenX: number, screenY: number) {
  const canvasRect = canvasAreaRef.value?.getBoundingClientRect();
  if (!canvasRect) return;

  const isBg = item.type === 'color';
  const x = screenX - canvasRect.left;
  const y = screenY - canvasRect.top;

  // 限制在画布范围内
  const clampedX = Math.max(10, Math.min(canvasRect.width - 10, x));
  const clampedY = Math.max(10, Math.min(canvasRect.height - 10, y));

  const el: CanvasElement = {
    id: `el_${++elemCounter}_${Date.now()}`,
    content: item.content,
    type: item.type,
    x: clampedX,
    y: clampedY,
    scale: 1,
    rotation: 0,
    fontSize: isBg ? 400 : 64,
  };

  if (isBg) {
    const existingBg = canvasElements.value.find(e => e.type === 'color');
    if (existingBg) {
      existingBg.content = el.content;
      saveDraft();
      return;
    }
    canvasElements.value.unshift(el);
  } else {
    canvasElements.value.push(el);
  }
  selectedId.value = el.id;
  saveDraft();
}

/** 判断点是否在矩形内 */
function isPointInRect(px: number, py: number, rect: DOMRect): boolean {
  return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
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

// ====== 画布导出 ======
/** 将画布元素合成为 768x768 图片（dataURL），供变身接口使用。
 *  限制分辨率可减少 localStorage / 接口传输压力，同时保留足够参考细节。 */
async function exportCanvasImage(): Promise<string> {
  const W = 768;
  const H = 768;
  const rect = canvasAreaRef.value?.getBoundingClientRect();
  const srcW = rect?.width || W;
  const srcH = rect?.height || H;
  const kx = W / srcW;
  const ky = H / srcH;
  const kAvg = (kx + ky) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // 白底
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  const els = canvasElements.value;

  // 背景色元素：铺满整个画布
  const bg = els.find((e) => e.type === 'color');
  if (bg) {
    ctx.fillStyle = bg.content;
    ctx.fillRect(0, 0, W, H);
  }

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  for (const el of els) {
    if (el.type === 'color') continue;
    const cx = el.x * kx;
    const cy = el.y * ky;
    const size = el.fontSize * el.scale * kAvg;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((el.rotation * Math.PI) / 180);

    if (el.type === 'svg') {
      const img = await loadImage(el.content);
      if (img) {
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
      }
    } else {
      ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(el.content, 0, 0);
    }
    ctx.restore();
  }

  try {
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return '';
  }
}

async function handleTransform() {
  if (canvasElements.value.length === 0) return;
  saveDraft();

  // 导出画布为图片，传递画布数据到变身页
  const image = await exportCanvasImage();
  if (!image || image.length < 100) {
    message.warning('画布导出失败，请重试～');
    return;
  }

  const data = {
    image,
    description: description.value,
  };
  try {
    localStorage.setItem('bb_transform_data', JSON.stringify(data));
  } catch {
    message.warning('图片过大，请减少素材后重试～');
    return;
  }
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
  cleanupTouchDrag();
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

/* PC 端全局菜单可见时不需要返回按钮 */
@media (min-width: 769px) {
  .back-btn--mobile-only {
    display: none;
  }
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
  cursor: grab;
  transition: all 0.2s;
  flex-shrink: 0;
  min-width: 56px;
  user-select: none;
  -webkit-user-select: none;
}

.material-item:active {
  cursor: grabbing;
  background: #FFF3E8;
  border-color: rgba(255, 140, 66, 0.3);
  transform: scale(0.95);
}

.material-item.is-dragging {
  opacity: 0.4;
  transform: scale(0.9);
}

.material-emoji {
  font-size: 32px;
  line-height: 1;
}

.material-svg-img {
  width: 36px;
  height: 36px;
  object-fit: contain;
  pointer-events: none;
}

.material-color-swatch {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid rgba(0,0,0,0.06);
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
  transition: border-color 0.2s, background-color 0.2s;
}

.canvas-area.drag-over {
  border-color: #4ECDC4;
  border-style: solid;
  background: rgba(78, 205, 196, 0.04);
  box-shadow: inset 0 0 0 3px rgba(78, 205, 196, 0.1);
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

.element-svg {
  display: block;
  object-fit: contain;
  pointer-events: none;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.12));
}

.element-bg {
  position: absolute;
  top: -100%;
  left: -100%;
  width: 300%;
  height: 300%;
  border-radius: 0;
  pointer-events: none;
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
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  color: #bbb;
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

/* 触摸拖拽幽灵元素 */
.drag-ghost {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 14px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.15), 0 0 0 2px rgba(78, 205, 196, 0.3);
  transition: none;
  will-change: left, top;
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

/* ===== 响应式 - PC：两栏工作室布局 ===== */
@media (min-width: 768px) {
  .create-page {
    display: grid;
    grid-template-columns: 280px 1fr;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    grid-template-areas:
      "top      top"
      "tabs     tabs"
      "mats     canvas"
      "desc     desc";
    min-height: 100vh;
  }

  /* 顶部栏：横跨两列 */
  .top-bar {
    grid-area: top;
    padding: 14px 24px;
  }

  /* Tab：横跨两列，左对齐（贴在左侧栏顶部） */
  .material-tabs {
    grid-area: tabs;
    padding: 8px 16px 12px 16px;
    border-bottom: 1px solid rgba(255, 140, 66, 0.08);
    background: #fff;
  }

  /* 素材区：左侧栏，与画布在同一弹性行，内部滚动 */
  .material-strip {
    grid-area: mats;
    padding: 16px;
    overflow-x: hidden;
    overflow-y: auto;
    background: #fff;
    border-right: 1px solid rgba(255, 140, 66, 0.08);
  }

  .material-list {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    justify-content: initial;
    flex-wrap: initial;
  }

  .material-item {
    padding: 12px 8px;
    min-width: 0;
  }

  .material-svg-img {
    width: 40px;
    height: 40px;
  }

  .material-emoji {
    font-size: 34px;
  }

  .material-color-swatch {
    width: 40px;
    height: 40px;
  }

  .material-label {
    font-size: 11px;
  }

  /* 画布区：右侧主舞台 */
  .canvas-area {
    grid-area: canvas;
    margin: 12px 20px;
    border-radius: 20px;
    box-shadow: 0 4px 24px rgba(255, 140, 66, 0.06);
    min-height: 0;
  }

  /* 描述 + 操作栏：横跨两列 */
  .desc-area {
    grid-area: desc;
    padding: 0 20px 4px;
  }

  .desc-input {
    background: #fff;
  }

  /* PC 端顶部栏已有「变变」按钮，底部操作栏隐藏避免与内容抢空间 */
  .bottom-bar {
    display: none;
  }

  .bottom-btn {
    padding: 14px 28px;
    font-size: 16px;
  }

  .btn-random {
    flex: initial;
    min-width: 140px;
  }

  .btn-transform {
    flex: initial;
    min-width: 200px;
  }
}

/* 更大屏：素材栏更宽，画布更宽 */
@media (min-width: 1200px) {
  .create-page {
    grid-template-columns: 320px 1fr;
  }

  .material-list {
    grid-template-columns: repeat(4, 1fr);
  }

  .canvas-area {
    margin: 16px 28px;
  }
}
</style>
