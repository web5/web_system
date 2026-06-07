# 代码规范与最佳实践

## TypeScript 规范

### 严格模式

所有 TypeScript 项目启用严格模式：

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

### 类型注解

```typescript
// ✅ 好的做法：明确类型
function detectDevice(params: DeviceParams): DeviceInfo {
  return { ... };
}

// ❌ 不好的做法：依赖类型推断（公共 API）
function detectDevice(params) {  // implicit any
  return { ... };
}
```

### 接口 vs 类型别名

```typescript
// 优先使用 interface（可扩展）
interface DeviceInfo {
  isIPad: boolean;
  isLandscape: boolean;
}

// 使用 type（联合类型、交叉类型）
type DeviceType = 'ipad' | 'iphone' | 'android';
```

---

## 命名约定

### 文件命名

| 类型 | 命名规则 | 示例 |
|------|----------|------|
| 工具函数 | kebab-case | `device.ts`, `canvas-engine.ts` |
| 组件（Vue） | kebab-case | `user-list.vue`, `draw-board.vue` |
| 组件（React） | PascalCase | `UserList.tsx`, `DrawBoard.tsx` |
| 类型定义 | kebab-case | `user.types.ts`, `api.types.ts` |
| 常量 | kebab-case + .constants | `draw.constants.ts` |
| 测试文件 | `<name>.test.ts` | `device.test.ts` |

### 变量/函数命名

```typescript
// ✅ 好的做法
const isLandscape = true;
const userName = 'Alice';
function detectDevice() { ... }
const formatDate = (date: Date) => { ... };

// ❌ 不好的做法
const flag = true;  // 含义不明确
const n = 'Alice';  // 缩写不明
function func1() { ... }  // 名称无意义
```

### 常量命名

```typescript
// ✅ 好的做法
const MAX_CANVAS_WIDTH = 1920;
const API_BASE_URL = 'https://api.example.com';

// 枚举
enum BrushType {
  PEN = 'pen',
  ERASER = 'eraser',
}
```

---

## 代码组织

### 导入顺序

```typescript
// 1. 外部库
import { defineComponent } from 'vue';
import { ref, computed } from 'vue';

// 2. 内部模块（绝对路径）
import { DeviceInfo } from '@/types';
import { detectDevice } from '@/utils/device';

// 3. 相对路径（近到远）
import { BrushType } from './draw.constants';
import { CanvasEngine } from '../utils/CanvasEngine';

// 4. 类型导入
import type { User } from './types';
```

### 函数组织

```typescript
class DrawPage {
  // 1. 公开属性
  public brushType: BrushType = BrushType.PEN;
  
  // 2. 私有属性
  private canvasEngine: CanvasEngine;
  
  // 3. 生命周期方法
  onLoad() { ... }
  onReady() { ... }
  
  // 4. 公开方法
  public changeBrush() { ... }
  
  // 5. 私有方法
  private resizeCanvas() { ... }
}
```

---

## Vue 3 规范

### 组件结构

```vue
<script setup lang="ts">
// 导入
import { ref, computed } from 'vue';
import { BrushType } from './draw.constants';

// 属性
const props = defineProps<{
  width: number;
  height: number;
}>();

// 事件
const emit = defineEmits<{
  (e: 'brush-change', type: BrushType): void;
}>();

// 响应式状态
const brushType = ref<BrushType>(BrushType.PEN);

// 计算属性
const isPen = computed(() => brushType.value === BrushType.PEN);

// 方法
function changeBrush(type: BrushType) {
  brushType.value = type;
  emit('brush-change', type);
}
</script>

<template>
  <!-- 模板 -->
</template>

<style scoped>
/* 样式 */
</style>
```

### 组合式 API 优先

```typescript
// ✅ 好的做法：使用 Composition API
<script setup lang="ts">
import { ref, computed } from 'vue';

const count = ref(0);
const doubled = computed(() => count.value * 2);
</script>

// ❌ 避免：Options API（除非维护旧代码）
export default {
  data() { return { count: 0 }; },
  computed: { doubled() { return this.count * 2; } }
}
```

---

## NestJS 规范

### 控制器结构

```typescript
// users.controller.ts
import { Controller, Get, Param } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './user.entity';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<User> {
    return this.usersService.findOne(id);
  }
}
```

### 服务层规范

```typescript
// users.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  findAll(): Promise<User[]> {
    return this.userRepository.find();
  }
}
```

---

## 错误处理

### Try-Catch 使用

```typescript
// ✅ 好的做法：明确错误处理
async function loadDeviceInfo() {
  try {
    const info = wx.getSystemInfoSync();
    return info;
  } catch (error) {
    console.error('Failed to get device info:', error);
    // 返回默认值或 re-throw
    throw new Error('Device info unavailable');
  }
}
```

### 自定义错误类

```typescript
// errors/DeviceError.ts
export class DeviceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DeviceError';
  }
}

// 使用
throw new DeviceError('Device not supported', 'DEVICE_NOT_SUPPORTED');
```

---

## 注释规范

### JSDoc 注释

```typescript
/**
 * 检测设备类型和方向
 * @param params - 设备参数
 * @param params.model - 设备型号（如 'iPad Pro 11'）
 * @param params.windowWidth - 窗口宽度
 * @param params.windowHeight - 窗口高度
 * @returns 设备信息对象
 * @example
 * ```typescript
 * const info = detectDevice({
 *   model: 'iPad Pro 11',
 *   windowWidth: 834,
 *   windowHeight: 1194,
 * });
 * ```
 */
export function detectDevice(params: DeviceParams): DeviceInfo {
  // ...
}
```

### 代码注释

```typescript
// ✅ 好的做法：解释"为什么"，而不是"是什么"
// 使用 834x1194 是因为这是 iPad Pro 11 寸的屏幕尺寸
const IPAD_PRO_11_WIDTH = 834;
const IPAD_PRO_11_HEIGHT = 1194;

// ❌ 不好的做法：冗余注释
// 设置 brushType 为 PEN
this.brushType = BrushType.PEN;
```

---

## 测试规范

### 测试文件组织

```
utils/
├── device.ts
└── __tests__/
    └── device.test.ts  # 或者放在 tests/ 目录下
```

### 测试命名

```typescript
// ✅ BDD 风格描述
describe('detectDevice', () => {
  it('should return isIPad=true for iPad models', () => {
    // ...
  });
  
  it('should detect landscape when width > height', () => {
    // ...
  });
});
```

---

## Linter 配置

### ESLint 规则（推荐）

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    // 禁止 var
    'no-var': 'error',
    // 优先使用 const
    'prefer-const': 'error',
    // 显式返回值类型
    '@typescript-eslint/explicit-function-return-type': 'warn',
    // 禁止 any
    '@typescript-eslint/no-explicit-any': 'error',
  },
};
```

---

## Git 提交规范

### Conventional Commits

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**类型（type）：**
- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 重构（不改变行为的代码变更）
- `test`: 测试相关
- `docs`: 文档更新
- `style`: 代码格式（不影响代码运行）
- `chore`: 构建/工具链变更

**示例：**
```
feat(mini-app): add device detection utility
fix(portal): resolve request.ts variable naming conflict
refactor(servers): simplify proxy service configuration
test(mini-app): add unit tests for detectDevice
```

---

## 性能优化建议

### 避免不必要的重渲染

```typescript
// ✅ 使用 computed 缓存计算结果
const doubled = computed(() => count.value * 2);

// ✅ 使用 React.memo / Vue 的 shallowRef
```

### 懒加载

```typescript
// Vue 路由懒加载
const routes = [
  {
    path: '/draw',
    component: () => import('./pages/draw/draw.vue'),
  },
];
```

---

## 安全检查清单

- [ ] 不将敏感信息（API Key、密码）提交到代码仓库
- [ ] 使用环境变量存储敏感配置
- [ ] 输入验证（前端 + 后端双重验证）
- [ ] SQL 注入防护（使用 TypeORM 参数化查询）
- [ ] XSS 防护（Vue 自动转义，注意 v-html 使用）
- [ ] CSRF 防护（NestJS 启用 CSRF 保护）
