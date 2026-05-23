# 空白画布素材选择栏 —— 技术方案

> 版本：v1.0  
> 日期：2026-05-23  
> 状态：设计中

---

## 1. 需求背景

当前画板打开后直接呈现一张空白画布，用户在没有任何灵感时可能会感到无从下手。需要在**画布为空**的状态下，在顶部区域展示一个素材选择栏，提供一些预设图案、模板、文字等作为灵感触发点，用户点击后即可将素材插入画布。

---

## 2. 交互设计

### 2.1 触发条件

素材栏**仅在以下条件同时满足时**显示：

| 条件 | 说明 |
|------|------|
| 所有图层均为空白 | 各图层的离屏 Canvas 无任何绘制像素 |
| 未在取色模式 | `isPickingColor === false` |
| 未在绘制中 | `isDrawing === false` |
| 无面板打开 | 所有 slide-panel 均处于关闭状态 |

### 2.2 UI 布局

```
┌──────────────────────────────────┐
│         素材选择栏 (顶部)          │  ← 横向滚动，半透明背景
│  [🍎] [🌳] [🏠] [⭐] [❤️] [更多]  │
├──────────────────────────────────┤
│                                  │
│          画布区域                 │
│                                  │
│                                  │
├──────────────────────────────────┤
│         缩放工具栏                │
├──────────────────────────────────┤
│         功能工具栏                │
└──────────────────────────────────┘
```

### 2.3 素材栏消失逻辑

以下任一操作触发后，素材栏**渐隐消失**：

1. 用户在画布上开始绘制（`onTouchStart` → `beginDraw`）
2. 用户导入图片（`onImportImage`）
3. 用户通过素材栏选择了素材并插入画布

素材栏同时提供**关闭按钮（×）**，用户可主动关闭。关闭后本次会话不再显示。

---

## 3. 技术方案

### 3.1 数据结构

```typescript
// draw.constants.ts 中新增

/** 素材分类 */
export type MaterialCategory = 'shape' | 'sticker' | 'text' | 'background';

/** 素材项 */
export interface MaterialItem {
  id: string;
  category: MaterialCategory;
  name: string;          // 展示名称
  icon: string;          // emoji / SVG data URI
  preview: string;       // 预览图（可选，用于 hover 效果）
  type: 'svg_path' | 'emoji' | 'pattern' | 'text' | 'image_url';
  data: string | {       // 根据 type 不同而异
    paths?: string[];     // SVG path d 属性数组
    text?: string;        // 文字内容
    fontSize?: number;
    url?: string;         // 图片 URL（如有 CDN）
  };
  defaultScale?: number;  // 插入时的默认缩放比例
  defaultColor?: string;  // 默认颜色（🆕 仅对路径素材有效）
}

/** 素材库 */
export const MATERIAL_LIBRARY: MaterialItem[] = [
  // === 形状类 ===
  { id: 'shape_circle',    category: 'shape', name: '圆',    icon: '⭕', type: 'svg_path', data: { paths: ['circle'] },    defaultScale: 0.5 },
  { id: 'shape_rect',      category: 'shape', name: '矩形',  icon: '▬',  type: 'svg_path', data: { paths: ['rect'] },      defaultScale: 0.5 },
  { id: 'shape_triangle',  category: 'shape', name: '三角',  icon: '△',  type: 'svg_path', data: { paths: ['triangle'] },  defaultScale: 0.5 },
  { id: 'shape_star',      category: 'shape', name: '五角星',icon: '⭐', type: 'svg_path', data: { paths: ['star5'] },    defaultScale: 0.5 },
  { id: 'shape_heart',     category: 'shape', name: '心形',  icon: '❤️', type: 'svg_path', data: { paths: ['heart'] },     defaultScale: 0.5 },

  // === 贴纸类（emoji） ===
  { id: 'sticker_smile',   category: 'sticker', name: '笑脸',  icon: '😊',    type: 'emoji',  data: { text: '😊' },        defaultScale: 0.4 },
  { id: 'sticker_flower',  category: 'sticker', name: '花',    icon: '🌸',    type: 'emoji',  data: { text: '🌸' },        defaultScale: 0.4 },

  // === 动物 & 植物（SVG 路径） ===
  { id: 'sticker_cat',     category: 'sticker', name: '猫',    icon: '🐱',    type: 'svg_path', data: { paths: ['cat'] },    defaultScale: 0.45, defaultColor: '#FF8C00' },
  { id: 'sticker_dog',     category: 'sticker', name: '狗',    icon: '🐶',    type: 'svg_path', data: { paths: ['dog'] },    defaultScale: 0.45, defaultColor: '#8B5E3C' },
  { id: 'sticker_fish',    category: 'sticker', name: '鱼',    icon: '🐟',    type: 'svg_path', data: { paths: ['fish'] },   defaultScale: 0.4,  defaultColor: '#4A90D9' },
  { id: 'sticker_tree',    category: 'sticker', name: '树',    icon: '🌳',    type: 'svg_path', data: { paths: ['tree'] },   defaultScale: 0.5,  defaultColor: '#2D8B4E' },

  // === 背景类 ===
  { id: 'bg_grid',         category: 'background', name: '网格', icon: '📐', type: 'image_url', data: { url: '/assets/bg_grid.png' }, defaultScale: 1.0 },
];
```

### 3.2 空画布检测

在 `CanvasEngine` 中新增方法：

```typescript
/** 检测所有图层是否均为空白 */
isCanvasBlank(): boolean {
  for (const layer of this.layers) {
    const imageData = layer.ctx.getImageData(
      0, 0, this.width * this.dpr, this.height * this.dpr
    );
    const pixels = imageData.data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] !== 0) return false; // 有任何不透明像素
    }
  }
  return true;
}
```

> ⚠️ 性能注意：`getImageData` 在全画布尺寸上操作可能较慢。优化方案：
> - 仅采样检测（每 N 个像素检测一次）
> - 或在 `draw.ts` 中维护一个 `hasAnyDrawing` 布尔标记，在 `endPath` / `clear` / `importImage` 时更新

**推荐方案**：使用布尔标记 + 采样回退：

```typescript
// CanvasEngine 中
private _hasContent = false;

get hasContent(): boolean { return this._hasContent; }

endPath(x, y) {
  // ... 原有逻辑 ...
  if (!this._hasContent) this._hasContent = true;
}

clear() {
  // ... 原有逻辑 ...
  this._hasContent = false;
}

importImage(path) {
  // ... 原有逻辑 ...
  this._hasContent = true;
}

undo() {
  // ... 原有逻辑 ...
  // undo 后需要重新采样检测
}

// draw.ts 中
checkCanvasBlank() {
  if (!this.engine) return;
  // 优先用标记
  const blank = !this.engine.hasContent;
  this.setData({ showMaterialBar: blank });
}
```

### 3.3 页面状态扩展

在 `draw.ts` 的 `data` 中新增：

```typescript
data: {
  // ... 原有字段 ...
  
  // 素材栏
  showMaterialBar: false,
  materialCategories: ['all', 'shape', 'sticker', 'background'] as const,
  activeMaterialCategory: 'all',
  materials: MATERIAL_LIBRARY,
  materialBarDismissed: false,   // 用户主动关闭后本会话不再显示
}
```

### 3.4 WXML 模板

```xml
<!-- 顶部素材选择栏 -->
<view class="material-bar {{showMaterialBar && !materialBarDismissed ? 'show' : ''}}"
      wx:if="{{!isPickingColor && !isDrawing}}">
  <!-- 分类标签 -->
  <scroll-view class="mb-categories" scroll-x>
    <view class="mb-cat {{activeMaterialCategory === item ? 'active' : ''}}"
          wx:for="{{materialCategories}}" wx:key="*this"
          data-category="{{item}}"
          bindtap="onMaterialCategoryChange">{{item === 'all' ? '全部' : item === 'shape' ? '形状' : item === 'sticker' ? '贴纸' : '背景'}}</view>
  </scroll-view>

  <!-- 素材列表 -->
  <scroll-view class="mb-list" scroll-x>
    <view class="mb-item" wx:for="{{filteredMaterials}}" wx:key="id"
          data-material="{{item}}" bindtap="onSelectMaterial">
      <text class="mb-item-icon">{{item.icon}}</text>
      <text class="mb-item-name">{{item.name}}</text>
    </view>
  </scroll-view>

  <!-- 关闭按钮 -->
  <view class="mb-close" bindtap="onDismissMaterialBar">
    <image class="tb-icon xs" src="{{icons.close}}" mode="aspectFit" />
  </view>
</view>
```

### 3.5 素材插入逻辑

```typescript
// draw.ts 中新增

onSelectMaterial(e) {
  const item = e.currentTarget.dataset.material as MaterialItem;
  // 关闭素材栏
  this.setData({ showMaterialBar: false });

  // 根据类型插入
  switch (item.type) {
    case 'svg_path':
      this.insertSvgPaths(item);
      break;
    case 'emoji':
      this.insertEmoji(item);
      break;
    case 'image_url':
      this.insertImageMaterial(item);
      break;
  }
}

/** 插入 SVG 路径形状 */
insertSvgPaths(item: MaterialItem) {
  const ctx = this.engine!.getActiveCtx();
  if (!ctx) return;
  const scale = item.defaultScale || 0.5;
  const cx = this.engine!.width / 2;
  const cy = this.engine!.height / 2;
  const size = Math.min(this.engine!.width, this.engine!.height) * scale;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = this.data.currentColor;
  // 根据 item.data.paths 绘制对应形状到 ctx
  // 预定义的 SVG path → Canvas Path2D 映射
  this.drawShapeByPath(ctx, item.data.paths!, size);
  ctx.restore();
  this.engine!.compositeToMain();
  this.engine!.saveSnapshot();
}

/** 插入 Emoji 文字 */
insertEmoji(item: MaterialItem) {
  const ctx = this.engine!.getActiveCtx();
  if (!ctx) return;
  const scale = item.defaultScale || 0.4;
  const fontSize = Math.min(this.engine!.width, this.engine!.height) * scale * 0.3;
  ctx.save();
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(item.data.text!, this.engine!.width / 2, this.engine!.height / 2);
  ctx.restore();
  this.engine!.compositeToMain();
  this.engine!.saveSnapshot();
}
```

### 3.6 形状路径预定义

```typescript
// draw.constants.ts 中新增

/** 预设形状的 Canvas Path2D 绘制函数 */
export const SHAPE_DRAWERS: Record<string, (ctx: any, size: number) => void> = {
  circle(ctx, size) {
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fill();
  },
  rect(ctx, size) {
    ctx.fillRect(-size / 2, -size / 2, size, size);
  },
  triangle(ctx, size) {
    const r = size / 2;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.866, r * 0.5);
    ctx.lineTo(-r * 0.866, r * 0.5);
    ctx.closePath();
    ctx.fill();
  },
  star5(ctx, size) {
    const r = size / 2;
    const innerR = r * 0.38;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const outerAngle = (Math.PI / 2 * -1) + (2 * Math.PI * i / 5);
      const innerAngle = outerAngle + (Math.PI / 5);
      if (i === 0) ctx.moveTo(r * Math.cos(outerAngle), r * Math.sin(outerAngle));
      else ctx.lineTo(r * Math.cos(outerAngle), r * Math.sin(outerAngle));
      ctx.lineTo(innerR * Math.cos(innerAngle), innerR * Math.sin(innerAngle));
    }
    ctx.closePath();
    ctx.fill();
  },
  heart(ctx, size) {
    // 使用贝塞尔曲线绘制心形
    const s = size * 0.2;
    ctx.beginPath();
    ctx.moveTo(0, s * 1.5);
    ctx.bezierCurveTo(-s * 2, -s * 0.5, -s * 1.5, -s * 2.5, 0, -s * 1.5);
    ctx.bezierCurveTo(s * 1.5, -s * 2.5, s * 2, -s * 0.5, 0, s * 1.5);
    ctx.fill();
  },

  // ===== 动物 & 植物 =====

  cat(ctx, size) {
    // 坐姿小猫剪影：圆头 + 三角耳 + 椭圆身体
    const s = size * 0.1;
    ctx.beginPath();
    // 左耳
    ctx.moveTo(-s * 1.6, -s * 0.5);
    ctx.lineTo(-s * 1.1, -s * 3.2);
    ctx.lineTo(-s * 0.3, -s * 0.8);
    // 头顶（左→右）
    ctx.quadraticCurveTo(0, -s * 3.5, s * 0.3, -s * 0.8);
    // 右耳
    ctx.lineTo(s * 1.1, -s * 3.2);
    ctx.lineTo(s * 1.6, -s * 0.5);
    // 右脸颊
    ctx.quadraticCurveTo(s * 2.2, s * 0.2, s * 1.8, s * 1.2);
    // 身体右侧
    ctx.quadraticCurveTo(s * 2.4, s * 2.0, s * 2.0, s * 3.5);
    // 底部
    ctx.quadraticCurveTo(s * 1.0, s * 4.0, 0, s * 4.0);
    ctx.quadraticCurveTo(-s * 1.0, s * 4.0, -s * 2.0, s * 3.5);
    // 身体左侧
    ctx.quadraticCurveTo(-s * 2.4, s * 2.0, -s * 1.8, s * 1.2);
    // 左脸颊
    ctx.quadraticCurveTo(-s * 2.2, s * 0.2, -s * 1.6, -s * 0.5);
    ctx.closePath();
    ctx.fill();

    // 尾巴（从右侧伸出，向上弯曲）
    ctx.beginPath();
    ctx.moveTo(s * 1.8, s * 2.5);
    ctx.quadraticCurveTo(s * 3.5, s * 1.5, s * 3.0, -s * 0.5);
    ctx.lineWidth = s * 0.6;
    ctx.lineCap = 'round';
    ctx.stroke();
  },

  dog(ctx, size) {
    // 小狗剪影：圆头 + 下垂大耳朵 + 椭圆身体
    const s = size * 0.1;
    ctx.beginPath();
    // 左耳（下垂）
    ctx.moveTo(-s * 1.5, -s * 1.0);
    ctx.quadraticCurveTo(-s * 3.0, -s * 0.2, -s * 2.8, s * 1.5);
    ctx.quadraticCurveTo(-s * 2.5, s * 2.0, -s * 1.6, s * 0.8);
    // 头顶
    ctx.quadraticCurveTo(-s * 1.8, -s * 3.0, 0, -s * 3.2);
    ctx.quadraticCurveTo(s * 1.8, -s * 3.0, s * 1.6, s * 0.8);
    // 右耳（下垂）
    ctx.quadraticCurveTo(s * 2.5, s * 2.0, s * 2.8, s * 1.5);
    ctx.quadraticCurveTo(s * 3.0, -s * 0.2, s * 1.5, -s * 1.0);
    // 右脸颊
    ctx.quadraticCurveTo(s * 2.2, s * 0.2, s * 1.8, s * 1.5);
    // 身体右侧
    ctx.quadraticCurveTo(s * 2.2, s * 2.5, s * 1.8, s * 3.8);
    // 底部
    ctx.quadraticCurveTo(s * 0.8, s * 4.3, 0, s * 4.3);
    ctx.quadraticCurveTo(-s * 0.8, s * 4.3, -s * 1.8, s * 3.8);
    // 身体左侧
    ctx.quadraticCurveTo(-s * 2.2, s * 2.5, -s * 1.8, s * 1.5);
    // 左脸颊
    ctx.quadraticCurveTo(-s * 2.2, s * 0.2, -s * 1.5, -s * 1.0);
    ctx.closePath();
    ctx.fill();
  },

  fish(ctx, size) {
    // 鱼形：椭圆身体 + 三角形尾巴 + 脊鳍
    const s = size * 0.12;
    ctx.beginPath();
    // 身体：横向椭圆
    ctx.ellipse(0, 0, s * 2.5, s * 1.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 尾巴（三角形，指向右后方）
    ctx.beginPath();
    ctx.moveTo(s * 2.0, s * 0.4);
    ctx.lineTo(s * 4.0, s * 2.0);
    ctx.lineTo(s * 4.0, -s * 2.0);
    ctx.lineTo(s * 2.0, -s * 0.4);
    ctx.closePath();
    ctx.fill();

    // 背鳍（三角形偏上）
    ctx.beginPath();
    ctx.moveTo(-s * 0.5, -s * 1.2);
    ctx.lineTo(s * 0.5, -s * 2.5);
    ctx.lineTo(s * 1.2, -s * 1.2);
    ctx.closePath();
    ctx.fill();
  },

  tree(ctx, size) {
    // 树：矩形树干 + 三层三角形树冠
    const s = size * 0.1;
    // 树干
    ctx.fillRect(-s * 1.0, s * 1.5, s * 2.0, s * 3.0);

    // 树冠（3 层三角形，从下到上）
    // 最下层
    ctx.beginPath();
    ctx.moveTo(0, -s * 2.0);
    ctx.lineTo(s * 3.5, s * 2.0);
    ctx.lineTo(-s * 3.5, s * 2.0);
    ctx.closePath();
    ctx.fill();

    // 中层
    ctx.beginPath();
    ctx.moveTo(0, -s * 3.5);
    ctx.lineTo(s * 2.8, s * 0.5);
    ctx.lineTo(-s * 2.8, s * 0.5);
    ctx.closePath();
    ctx.fill();

    // 顶层
    ctx.beginPath();
    ctx.moveTo(0, -s * 5.5);
    ctx.lineTo(s * 2.0, -s * 1.0);
    ctx.lineTo(-s * 2.0, -s * 1.0);
    ctx.closePath();
    ctx.fill();
  },
};
```

### 3.7 WXSS 样式

```css
/* ===== 顶部素材选择栏 ===== */
.material-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  padding: 16rpx 16rpx;
  padding-top: calc(16rpx + env(safe-area-inset-top));
  background: rgba(255,255,255,0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 2px 16px rgba(0,0,0,0.06);
  z-index: 45;
  transform: translateY(-120%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  gap: 8rpx;
}

.material-bar.show {
  transform: translateY(0);
}

.mb-categories {
  white-space: nowrap;
  flex-shrink: 0;
}

.mb-cat {
  display: inline-flex;
  padding: 8rpx 20rpx;
  border-radius: 24rpx;
  font-size: 22rpx;
  color: #6b7280;
  background: #f3f4f6;
  margin-right: 8rpx;
  transition: all 0.15s;
}

.mb-cat.active {
  background: #4f46e5;
  color: #fff;
}

.mb-list {
  flex: 1;
  white-space: nowrap;
}

.mb-item {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  padding: 10rpx 14rpx;
  border-radius: 16rpx;
  margin-right: 4rpx;
  transition: background 0.15s;
}

.mb-item:active {
  background: #f3f4f6;
}

.mb-item-icon {
  font-size: 36rpx;
  line-height: 1;
}

.mb-item-name {
  font-size: 18rpx;
  color: #9ca3af;
}

.mb-close {
  flex-shrink: 0;
  padding: 8rpx;
  opacity: 0.4;
  transition: opacity 0.15s;
}

.mb-close:active {
  opacity: 0.7;
}
```

---

## 4. 搜索与扩展（未来）

### 4.1 搜索素材

当素材较多时，可加入搜索入口：

```xml
<view class="mb-search" bindtap="onOpenMaterialSearch">
  <text class="mb-search-icon">🔍</text>
  <text class="mb-search-placeholder">搜索素材...</text>
</view>
```

### 4.2 AI 生成素材

素材栏末位加入 "AI 生成" 入口，跳转到后续的 AI 功能页面：

```xml
<view class="mb-item mb-item-ai" bindtap="onAIGenerate">
  <text class="mb-item-icon">✨</text>
  <text class="mb-item-name">AI 生成</text>
</view>
```

### 4.3 素材云端化

当下素材写死在前端常量中，后续可迁移为：

- **CDN 静态 JSON**：素材列表从远程拉取，支持热更新
- **后端素材库 API**：`GET /api/materials?category=shape`，支持搜索、分页
- **用户自定义素材**：用户上传的素材存储到云

---

## 5. 实现步骤

| 步骤 | 内容 | 预估工时 |
|------|------|---------|
| 1 | `CanvasEngine` 新增 `hasContent` 标记 + 检测方法 | 0.5h |
| 2 | `draw.constants.ts` 新增 `MATERIAL_LIBRARY` + `SHAPE_DRAWERS` | 1h |
| 3 | `draw.ts` 新增素材栏状态、选择/插入/关闭逻辑 | 1.5h |
| 4 | `draw.wxml` 新增素材栏模板 | 0.5h |
| 5 | `draw.wxss` 新增素材栏样式 | 0.5h |
| 6 | 真机测试（iPhone + Android） | 1h |
| **合计** | | **~5h** |

---

## 6. 风险与注意事项

1. **空画布检测性能**：`getImageData` 在大画布（如 iPhone Pro Max 的 3x DPR）上可能超过 50ms。推荐使用布尔标记 `hasContent` 作为主判断，仅在 undo/redo 后做采样回退检测。
2. **素材栏遮挡**：顶部栏会占据约 80rpx 高度，注意与画布的 z-index 层级关系。素材栏 z-index 设为 45（低于面板的 90/100）。
3. **取色模式冲突**：取色模式下素材栏不应显示（已通过 `wx:if` 条件处理）。
4. **缩放影响**：插入素材的坐标使用世界坐标（画布中心），不受当前缩放/平移影响。

---

## 7. 未来扩展思路（AI 相关）

| 方向 | 描述 |
|------|------|
| AI 生成形状 | 根据用户文字描述生成矢量图形（如 "画一个苹果"） |
| AI 补全涂鸦 | 用户画几笔，AI 根据轮廓建议完整图案 |
| AI 风格迁移 | 将当前画布内容转为某种风格（水彩、油画、素描） |
| AI 文字生成贴纸 | "生成一个可爱的小猫贴纸" → 插入画布 |
| 素材推荐引擎 | 根据用户绘画内容智能推荐相关素材 |
