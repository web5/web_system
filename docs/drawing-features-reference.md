# 画板功能特性与技术方案总结

> 版本：v2.0  
> 日期：2026-05-23  
> 用途：AI 功能实现知识库，帮助后续开发者快速理解现有架构

---

## 目录

1. [项目概览](#1-项目概览)
2. [文件结构](#2-文件结构)
3. [架构设计](#3-架构设计)
4. [核心模块详解](#4-核心模块详解)
5. [功能特性清单](#5-功能特性清单)
6. [数据流与状态管理](#6-数据流与状态管理)
7. [UI 布局与交互](#7-ui-布局与交互)
8. [技术栈 & 依赖](#8-技术栈--依赖)
9. [已知限制 & 待优化](#9-已知限制--待优化)
10. [AI 功能接入点](#10-ai-功能接入点)

---

## 1. 项目概览

本项目是一个**微信小程序**，核心功能是**画板（Drawing Board）**。用户可以在移动端进行自由绘画，支持多笔刷、多图层、取色、缩放拖动、撤销重做、导入图片、保存到相册等完整功能。

- **小程序 AppID**：`wxe7635bce95e7cff0`
- **基础库版本**：`3.3.4`
- **API 服务地址**：`https://api.kedouai.com`
- **页面路由**：`pages/index/index`（首页） → `pages/draw/draw`（画板）

---

## 2. 文件结构

```
apps/mini-app/
├── app.json                          # 页面注册
├── app.ts                             # 全局入口
├── pages/
│   ├── index/                         # 首页（仅一个跳转按钮）
│   │   ├── index.ts
│   │   ├── index.wxml
│   │   └── index.wxss
│   └── draw/                          # ★ 画板页面
│       ├── draw.ts                    # 页面主逻辑（611 行）
│       ├── draw.wxml                  # 页面模板
│       ├── draw.wxss                  # 页面样式
│       └── draw.constants.ts          # 图标/颜色/笔刷常量
└── utils/                             # ★ 引擎核心
    ├── CanvasEngine.ts                # 画布引擎（478 行）
    ├── Brush.ts                       # 笔刷定义（76 行）
    ├── Layer.ts                       # 图层管理（92 行）
    └── History.ts                     # 撤销/重做（91 行）
```

---

## 3. 架构设计

### 3.1 整体分层

```
┌──────────────────────────────────────────────────────────┐
│  draw.ts (Page 页面)  —  触摸事件 / UI 状态 / 面板控制     │
│  ┌────────────────────────────────────────────────────┐  │
│  │  触摸事件    坐标转换    面板切换                     │  │
│  │  笔刷选择    颜色选择    撤销/重做                    │  │
│  │  图层管理    导入/保存   取色/背景                    │  │
│  │  缩放工具    设置面板    ...                          │  │
│  └───────────────┬────────────────────────────────────┘  │
│                  │                                        │
│  ┌───────────────▼────────────────────────────────────┐  │
│  │  CanvasEngine (纯逻辑类，无 UI 依赖)                 │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │  │
│  │  │ Brush    │ │ Layer    │ │ HistoryManager     │  │  │
│  │  │ 笔刷预设 │ │ 图层管理 │ │ 快照 undo/redo     │  │  │
│  │  └──────────┘ └──────────┘ └───────────────────┘  │  │
│  │                                                     │  │
│  │  核心渲染: Catmull-Rom 样条插值                       │  │
│  │  视口变换: panX/panY/scale → screenToWorld()         │  │
│  │  双Canvas: 图层离屏canvas → 主canvas合成              │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 3.2 设计原则

| 原则 | 实现 |
|------|------|
| **页面与引擎分离** | `draw.ts` 只负责 UI 和事件，`CanvasEngine` 是纯逻辑类 |
| **离屏渲染** | 每个图层有独立 `OffscreenCanvas`，绘制不直接操作主 Canvas |
| **先合成再显示** | 所有图层定期 `compositeToMain()` 合并到主 Canvas 上 |
| **屏幕/世界坐标分离** | 用户触摸坐标（屏幕）→ `screenToWorld()` → 世界坐标 → 绘制 |
| **Catmull-Rom 平滑** | 所有笔迹使用 Catmull-Rom 样条插值，消除锯齿感 |

---

## 4. 核心模块详解

### 4.1 CanvasEngine —— 画布引擎

**文件**：`utils/CanvasEngine.ts`

**职责**：
- 管理所有图层（`layers: LayerData[]`）
- 管理当前笔刷状态（`currentBrush`, `currentColor`, `currentSize`）
- 执行绘制命令（`beginPath` → `drawSegment` → `endPath`）
- 合成所有图层到主 Canvas（`compositeToMain`）
- 视口变换（`panX`, `panY`, `scale`）
- 历史快照管理（`HistoryManager`）

**关键属性**：

```typescript
class CanvasEngine {
  width: number;           // 画布 CSS 像素宽度
  height: number;          // 画布 CSS 像素高度
  dpr: number;             // 设备像素比
  mainCtx: any;            // 主 Canvas 2D Context
  mainCanvas: any;         // 主 Canvas 节点

  layers: LayerData[];     // 图层数组
  activeLayerIndex: number;// 当前活动图层索引
  currentBrush: BrushConfig;// 当前笔刷配置
  currentColor: string;    // 当前颜色
  currentSize: number;     // 当前笔刷大小
  backgroundColor: string; // 背景色（空字符串=透明）

  panX: number;            // X 轴平移量
  panY: number;            // Y 轴平移量
  scale: number;           // 缩放比例（0.3 ~ 5.0）

  history: HistoryManager; // 历史快照管理器
}
```

**绘制流程**：

```
beginPath(x, y)
  ↓ ctx.save() → 设置线宽/线帽/连接/颜色/透明度/混合模式
  ↓ ctx.arc() → 画一个实心圆（起笔点）
  ↓ pointBuffer = [{x, y}]

drawSegment(x, y)    // touchMove 每帧调用
  ↓ pointBuffer.push({x, y})
  ↓ Catmull-Rom 样条插值（从上次已绘点之后开始）
  ↓ compositeToMain() → 实时显示

endPath(x, y)        // touchEnd
  ↓ 画最后一段线到终点
  ↓ ctx.restore()
  ↓ compositeToMain()
  ↓ saveSnapshot()
```

### 4.2 Brush —— 笔刷系统

**文件**：`utils/Brush.ts`

**四种笔刷**：

| 类型 | `type` | 默认大小 | 透明度 | 混合模式 | 用途 |
|------|--------|----------|--------|----------|------|
| 铅笔 | `pencil` | 3px | 1.0 | `source-over` | 标准不透明绘制 |
| 马克笔 | `marker` | 6px | 0.85 | `source-over` | 半透明粗笔 |
| 荧光笔 | `highlighter` | 20px | 0.3 | `multiply` | 半透明叠加效果 |
| 橡皮擦 | `eraser` | 15px | 1.0 | `destination-out` | 擦除像素 |

**接口定义**：

```typescript
type BrushType = 'pencil' | 'marker' | 'highlighter' | 'eraser';

interface BrushConfig {
  type: BrushType;
  name: string;        // 中文名
  icon: string;        // emoji 图标
  size: number;        // 默认粗细
  minSize: number;     // 最小粗细
  maxSize: number;     // 最大粗细
  opacity: number;     // 透明度 0-1
  blur: number;        // 模糊（当前未使用）
  composite: GlobalCompositeOperation;  // Canvas 混合模式
  color: string;       // 颜色（仅铅笔/马克笔生效）
}
```

### 4.3 Layer —— 图层系统

**文件**：`utils/Layer.ts`

**数据结构**：

```typescript
interface LayerData {
  id: string;          // 唯一标识（layer_时间戳_计数）
  name: string;        // 显示名称
  visible: boolean;    // 是否可见
  opacity: number;     // 图层不透明度
  canvas: any;         // 离屏 OffscreenCanvas
  ctx: any;            // 离屏 Canvas 2D Context
}
```

**关键操作**：

| 方法 | 说明 |
|------|------|
| `createLayer(engine)` | 创建新图层，尺寸为 `width*dpr × height*dpr` |
| `compositeLayers(layers, targetCtx, ...)` | 将所有可见图层 + 背景合成到目标 Context |

**合成顺序**：
1. 清空主 Canvas → 填充背景色（透明时画棋盘格）
2. `ctx.translate(panX, panY)` + `ctx.scale(scale, scale)` → 应用视口变换
3. 逐层 `drawImage(layer.canvas)` 从底层到顶层
4. 恢复 `globalAlpha` 和 transforms

### 4.4 History —— 撤销/重做

**文件**：`utils/History.ts`

**核心机制**：基于主 Canvas 的 `getImageData` / `putImageData` 像素快照。

```typescript
interface Snapshot {
  imageData: ImageData;     // 主 Canvas 像素数据
  backgroundColor: string;  // 当时的背景色
}

class HistoryManager {
  private snapshots: Snapshot[];  // 快照栈
  private currentIndex: number;   // 当前位置
  private maxSize = 30;           // 最大快照数

  push(sourceCtx, bgColor)  // 保存快照（每次 endPath / 背景变更 / 清空时调用）
  undo()                    // 后退一步
  redo()                    // 前进一步
  restore(targetCtx)        // 恢复到目标 Context
}
```

**注意**：快照保存整张主 Canvas 的像素数据（`width*dpr × height*dpr`），内存消耗较大。30 张快照在 iPhone Pro Max（3x, ~430×930）上约占用 30 × 430 × 930 × 4 = ~48MB。

---

## 5. 功能特性清单

### 5.1 绘画功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 铅笔绘制 | ✅ | 标准不透明线条，Catmull-Rom 平滑 |
| 马克笔绘制 | ✅ | 半透明粗线条 |
| 荧光笔绘制 | ✅ | 半透明叠加效果（multiply） |
| 橡皮擦 | ✅ | destination-out 模式擦除 |
| 笔刷大小调节 | ✅ | 滑块 1~40px |
| 颜色选择 | ✅ | 15 种预设颜色 |
| 背景色设置 | ✅ | 14 种纯色 + 透明 |
| 取色器 | ✅ | 点击画布拾取像素颜色 |

### 5.2 图层功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 新建图层 | ✅ | 右上角图层面板操作 |
| 删除图层 | ✅ | 至少保留一个图层 |
| 切换活动图层 | ✅ | 点击切换，当前活动图层高亮 |
| 图层可见性 | ✅ | 点击眼睛图标切换 |
| 向下合并 | ✅ | 将当前图层合并到下一层 |
| 图层按钮隐藏 | ✅ | 设置面板中可关闭（适合普通用户） |
| 背景层 | ✅ | 合成时填充背景色或透明棋盘格 |

### 5.3 视口操作

| 功能 | 状态 | 说明 |
|------|------|------|
| 缩放模式 | ✅ | 切换后单指拖动平移画布 |
| 双指缩放 | ✅ | 捏合缩放 + 平移 |
| 步进缩放 | ✅ | + / − 按钮 1.25x / 0.8x |
| 百分比显示 | ✅ | 底部缩放栏实时显示 |
| 重置缩放 | ✅ | 点击百分比恢复 100% |
| 重置视角 | ✅ | ⟲ 按钮恢复 pan + scale 到初始值 |

### 5.4 编辑功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 撤销 | ✅ | 最多 30 步 |
| 重做 | ✅ | 撤销后可重做 |
| 清空画布 | ✅ | 二次确认弹窗 |
| 保存到相册 | ✅ | `canvasToTempFilePath` + `saveImageToPhotosAlbum` |
| 导入图片 | ✅ | 从相册/相机选择，等比缩放居中 |

### 5.5 UI 交互

| 功能 | 状态 | 说明 |
|------|------|------|
| 底部功能栏 | ✅ | 颜色 / 保存 / 撤销 / 清空 / 设置 |
| 底部缩放栏 | ✅ | 缩放模式 / − / 百分比 / + / 重置视角 |
| 笔刷菜单 | ✅ | 长按颜色按钮弹出 |
| 笔刷面板 | ✅ | 底部滑出 |
| 颜色面板 | ✅ | 底部滑出 |
| 设置面板 | ✅ | 底部滑出 |
| 图层面板 | ✅ | 右侧滑出 |
| 取色提示条 | ✅ | 屏幕居中紫色提示 |
| 触摸反馈 | ✅ | `wx.vibrateShort` 撤销/重置时震动 |
| 面板互斥 | ✅ | 打开一个面板自动关闭其他 |

---

## 6. 数据流与状态管理

### 6.1 状态变量一览（draw.ts data）

```typescript
data: {
  // 颜色
  currentColor: '#FF8C00',    // 当前绘制颜色（默认亮橙）
  showBgColors: false,        // 是否显示背景色选择

  // 笔刷
  currentBrush: 'pencil',     // 当前笔刷类型
  brushSize: 3,               // 当前笔刷大小

  // 绘制状态
  isDrawing: false,           // 是否正在绘制中

  // 图层
  layers: [],                 // 图层列表（从 engine 同步）
  showLayers: false,          // 图层面板是否打开
  showLayerButton: false,     // 是否显示图层按钮（持久化到 storage）

  // 撤销/重做
  canUndo: false,
  canRedo: false,

  // 面板开关（互斥）
  showBrushPanel: false,
  showColorPanel: false,
  showActionPanel: false,
  showBrushMenu: false,       // 长按笔刷菜单
  showSettings: false,        // 设置面板

  // 背景
  isPickingBackground: false,
  backgroundColor: '#ffffff',

  // 取色器
  isPickingColor: false,

  // 缩放
  zoomLevel: 100,             // 百分比显示
  isZoomMode: false,          // 是否缩放/拖动模式

  // 画布尺寸
  canvasWidth: 0,
  canvasHeight: 0,
}
```

### 6.2 实例属性（非响应式）

```typescript
engine: CanvasEngine | null;  // 引擎实例
rectInfo: { left, top } | null;  // canvas 在屏幕上的位置（用于坐标转换）
lastX: number;                // 上一个世界坐标 X
lastY: number;                // 上一个世界坐标 Y
isTouching: boolean;          // 是否正在单指绘制
isPanning: boolean;           // 是否正在双指/单指拖动
pan: PanState;                // 拖动起始状态快照
```

### 6.3 数据流方向

```
触摸事件 (e.touches)
  ↓
getCanvasPos(e) → 屏幕坐标 → canvas 相对坐标
  ↓
engine.screenToWorld(sx, sy) → 应用 pan/scale → 世界坐标
  ↓
engine.beginPath(worldX, worldY)
engine.drawSegment(worldX, worldY, lastX, lastY)
  ↓
离屏 OffscreenCanvas 上绘制
  ↓
engine.compositeToMain() → 合成到主 Canvas
  ↓
主 Canvas 显示在屏幕上
```

### 6.4 状态同步时机

| 时机 | 同步内容 |
|------|---------|
| `initCanvas()` | 引擎初始化 → 设置 `layers`, `canvasWidth`, `canvasHeight` |
| `onTouchEnd()` | 绘制结束 → 更新 `canUndo`, `canRedo` |
| `selectBrush()` | 切换笔刷 → 更新 `currentBrush`, `brushSize` |
| `selectColor()` | 切换颜色 → 更新 `currentColor` |
| `onZoomIn/Out/Reset()` | 缩放变更 → 更新 `zoomLevel` |
| `updateLayers()` | 图层变更 → 同步 `layers` 数组 |
| `undo/redo` | 历史操作 → 更新 `canUndo`, `canRedo` |

---

## 7. UI 布局与交互

### 7.1 整体布局

```
┌──────────────────────────────────┐
│     Status Bar (系统)             │
├──────────────────────────────────┤
│     Navigation Bar (系统)         │ ← 标题: "画板"
├──────────────────────────────────┤
│                                  │
│          画布区域                  │  ← flex: 1, 全屏宽
│     (Canvas 2D, 白色背景)         │
│                                  │
│                                  │
├──────────────────────────────────┤
│  底部缩放栏 (fixed, z-index 50)   │  ← ✋ / − / 100% / + / ⟲
├──────────────────────────────────┤
│  底部功能栏 (fixed, z-index 50)   │  ← 🎨 / 💾 / ↩ / 🗑 / ⚙
├──────────────────────────────────┤
│     Safe Area (系统)              │
└──────────────────────────────────┘
```

### 7.2 浮层/面板（z-index 层次）

| 层级 | 组件 | z-index |
|------|------|---------|
| z-45 | 素材选择栏（规划中） | 45 |
| z-50 | 底部工具栏、缩放栏 | 50 |
| z-60 | 取色提示条 | 60 |
| z-90 | 遮罩层 overlay | 90 |
| z-100 | 所有滑出面板、笔刷菜单、图层面板 | 100 |

### 7.3 面板互斥逻辑

所有面板通过以下函数保证互斥：
- `toggleBrushPanel()` → 关闭颜色/操作面板
- `toggleActionPanel()` → 关闭笔刷/颜色面板
- `openColorPanel()` → 关闭笔刷/操作面板
- `closeAllPanels()` → 全部关闭

### 7.4 触摸事件路由

```
onTouchStart(e)
  ├── touches.length >= 2  → 双指拖动/缩放
  ├── 面板打开             → 忽略
  ├── isZoomMode         → 单指拖动
  ├── isPickingColor     → 忽略
  └── 否则               → beginDraw → 开始绘画

onTouchMove(e)
  ├── isPanning + 双指    → 双指拖动/缩放更新
  ├── isPanning + 单指    → 单指拖动更新
  ├── 面板/取色/无触摸    → 忽略
  └── 否则               → updateDraw → 绘制线段

onTouchEnd(e)
  ├── isPanning          → 拖动结束, 保存快照
  ├── isPickingColor     → 执行取色
  ├── isTouching         → endPath, 保存快照
  └── 否则               → 忽略
```

---

## 8. 技术栈 & 依赖

| 技术 | 版本 | 用途 |
|------|------|------|
| TypeScript | — | 页面和引擎逻辑 |
| 微信小程序 SDK 3.x | 3.3.4 | 基础框架 |
| Canvas 2D API | `type="2d"` | 画布渲染 |
| OffscreenCanvas | `wx.createOffscreenCanvas` | 图层离屏渲染 |
| Catmull-Rom 算法 | 自实现 | 笔迹平滑 |
| SVG Data URI | 自实现 | 图标系统 |
| pnpm | workspace | 包管理 |
| miniprogram-ci | — | CI/CD 预览/上传 |

---

## 9. 已知限制 & 待优化

| 问题 | 影响 | 建议 |
|------|------|------|
| 撤销/重做存整张 Canvas 像素数据 | 内存大（~48MB/30步） | 改为增量快照或图层级快照 |
| iPhone touch 事件冲突 | `bindtap` 与 `bindtouch*` 不可共存 | 已修复，移除 `bindtap` |
| 无压感支持 | 所有笔刷线条粗细恒定 | 可接入 `touch.force`（仅 iOS 3D Touch） |
| 颜色仅预设值 | 无法自定义颜色 | 后续可加色盘/取色器 |
| 图层无透明度/混合模式设置 | UI 已预留 `opacity` 字段 | 需补充 UI |
| 导入图片不支持裁剪/旋转 | 图片直接等比居中 | 后续可加变换工具 |
| 无网格/参考线（UI） | `toggleGrid` 方法已存在但未暴露 | 可加设置项 |
| 缩放不保存到快照 | undo 后 scale 不变 | 目前不影响使用 |

---

## 10. AI 功能接入点

以下是在现有架构上可接入 AI 功能的位置和建议：

### 10.1 绘画辅助

| 接入点 | 位置 | 方案 |
|--------|------|------|
| **涂鸦补全** | `endPath()` 之后 | 将当前图层像素发给 AI → 返回建议路径 → 绘制到画布 |
| **手绘识别** | `endPath()` 之后 | 对刚画的笔画做形状识别 → 替换为标准图形 |
| **AI 橡皮擦** | 新增笔刷类型 `ai_eraser` | 点选区域后 AI 智能去背景/对象移除 |

### 10.2 内容生成

| 接入点 | 位置 | 方案 |
|--------|------|------|
| **文生图插入** | 素材栏 "AI 生成" 入口 | 输入 prompt → 调用文生图 API → 作为新图层插入 |
| **图片风格迁移** | 导入图片后 | 选中图层 → 选择风格 → AI 处理 → 替换图层内容 |
| **智能背景** | 背景设置面板 | 选择场景描述 → AI 生成背景图 |

### 10.3 笔画增强

| 接入点 | 位置 | 方案 |
|--------|------|------|
| **笔画美化** | `drawSegment()` 实时 / `endPath()` 后处理 | 对 Catmull-Rom 点做 AI 平滑 → 生成更自然的曲线 |
| **压力模拟** | `touchMove` 处理 | 根据速度/方向模拟笔压 → 动态调整 `lineWidth` |

### 10.4 架构扩展建议

```
新增模块: utils/AIPainter.ts
├── generateImage(prompt)        → 文生图
├── enhanceStroke(points)        → 笔画美化
├── recognizeShape(points)       → 形状识别
├── completeDoodle(imageData)    → 涂鸦补全
├── styleTransfer(image, style)  → 风格迁移
└── smartBackground(prompt)      → 智能背景

新增面板: AI 助手面板（底部滑出）
├── 文生图输入框
├── 风格选择
├── 智能建议（根据当前画布内容）
└── 历史生成记录
```

---

## 附录

### A. 关键坐标系统

| 坐标类型 | 来源 | 使用场景 |
|----------|------|---------|
| 屏幕坐标 | `touch.clientX/Y` | 触摸事件原始坐标 |
| Canvas 相对坐标 | `clientX/Y - rectInfo.left/top` | 坐标转换中间步骤 |
| 世界坐标 | `screenToWorld(x, y)` = `(x - panX) / scale` | 实际绘制坐标 |
| Canvas 像素坐标 | `world * dpr` | getImageData / putImageData |

### B. Catmull-Rom 曲线公式

```typescript
catmullRom(p0, p1, p2, p3, t) {
  // p0..p3: 四个控制点, t: 0到1的参数
  // 返回 p1 到 p2 之间 t 位置的插值点
  // 曲线通过 p1 和 p2，p0 和 p3 影响曲率
}
```

### C. 混合模式参考

| 模式 | Canvas 值 | 用途 |
|------|-----------|------|
| 正常 | `source-over` | 铅笔、马克笔 |
| 正片叠底 | `multiply` | 荧光笔 |
| 擦除 | `destination-out` | 橡皮擦 |

### D. 可扩展笔刷参数

`BrushConfig` 接口已预留的未使用字段：
- `blur: number` — 可用于模糊滤镜效果
- 新增 `texture: string` — 可用于纹理笔刷
- 新增 `jitter: number` — 可用于抖动笔刷效果
