# TDD 测试驱动开发工作流程

## 核心理念

**红-绿-重构（Red-Green-Refactor）** 是 TDD 的核心循环：

1. **RED（红）** - 编写一个失败的测试
2. **GREEN（绿）** - 编写最少代码使测试通过
3. **REFACTOR（重构）** - 优化代码，保持测试通过

---

## 何时使用 TDD

| 场景 | 是否使用 TDD | 说明 |
|------|--------------|------|
| 新功能开发 | ✅ 强烈推荐 | 先写测试，明确需求 |
| Bug 修复 | ✅ 推荐 | 先写复现测试，再修复 |
| 重构 | ✅ 必须 | 确保有测试覆盖再重构 |
| 简单 UI 调整 | ⚠️ 可选 | 视复杂度而定 |
| 紧急热修复 | ⚠️ 可选 | 可后补测试 |

---

## TDD 开发步骤（详细）

### 步骤 1：理解需求

**目标：** 明确要做什么，预期行为是什么。

**行动：**
- 与用户确认需求细节
- 识别输入、输出、边界条件
- 确定测试 cases

**输出：** 清晰的验收标准

---

### 步骤 2：编写失败测试（RED）

**目标：** 编写一个描述预期行为的测试，此时测试应该失败。

**原则：**
- 测试描述使用自然语言（BDD 风格）
- 每个 `it()` 描述一个明确的预期行为
- 先测试最简单的 case

**示例（Jest + TypeScript）：**

```typescript
// tests/device.test.ts
describe('detectDevice', () => {
  it('should detect iPad Pro 11 inch correctly', () => {
    const result = detectDevice({
      model: 'iPad Pro 11',
      system: 'iOS 16.0',
      windowWidth: 834,
      windowHeight: 1194,
    });
    
    expect(result.isIPad).toBe(true);
    expect(result.isLandscape).toBe(true);
  });
});
```

**验证：** 运行测试，确认它失败（因为功能尚未实现）。

---

### 步骤 3：实现最小可用代码（GREEN）

**目标：** 编写最少量的代码，使测试通过。

**原则：**
- 不要过度设计
- 先让测试通过
- 可以接受"硬编码"的初始实现

**示例：**

```typescript
// utils/device.ts
export function detectDevice(params: DeviceParams) {
  // 最小实现：只让当前测试通过
  return {
    isIPad: true,
    isLandscape: true,
  };
}
```

**验证：** 运行测试，确认它通过。

---

### 步骤 4：添加更多测试 cases

**目标：** 覆盖更多场景，驱动代码完善。

**示例：**

```typescript
it('should detect iPhone as not iPad', () => {
  const result = detectDevice({
    model: 'iPhone 13',
    // ...
  });
  
  expect(result.isIPad).toBe(false);
});
```

**迭代：** 重复 RED-GREEN 循环，逐步完善实现。

---

### 步骤 5：重构（REFACTOR）

**目标：** 优化代码结构和可读性，保持测试通过。

**原则：**
- 消除重复代码
- 改善命名
- 提取公共逻辑
- 保持测试 100% 通过

**示例：**

```typescript
// 重构后
export function detectDevice(params: DeviceParams): DeviceInfo {
  const isIPad = params.model.toLowerCase().includes('ipad');
  const isLandscape = params.windowWidth > params.windowHeight;
  
  return { isIPad, isLandscape };
}
```

**验证：** 运行所有测试，确认全部通过。

---

## 测试编写最佳实践

### 1. 描述性测试名称

```typescript
// ❌ 不好的描述
it('test1', () => { ... });
it('should work', () => { ... });

// ✅ 好的描述（BDD 风格）
it('should return true when device is iPad', () => { ... });
it('should calculate canvas dimensions correctly in landscape mode', () => { ... });
```

### 2. AAA 模式（Arrange-Act-Assert）

```typescript
it('should detect landscape orientation', () => {
  // Arrange（准备）
  const params = {
    windowWidth: 1194,
    windowHeight: 834,
  };
  
  // Act（执行）
  const result = detectDevice(params);
  
  // Assert（断言）
  expect(result.isLandscape).toBe(true);
});
```

### 3. 测试边界条件

```typescript
// 测试边界
it('should handle square screen (width === height)', () => {
  const params = { windowWidth: 800, windowHeight: 800 };
  const result = detectDevice(params);
  
  expect(result.isLandscape).toBe(false); // 或根据业务定义
});
```

### 4. Mock 外部依赖

```typescript
// Mock wx API
global.wx = {
  getSystemInfoSync: jest.fn().mockReturnValue({
    model: 'iPad Pro 11',
    windowWidth: 834,
  }),
};
```

---

## 项目测试配置

### Jest 配置（mini-app）

**文件：** `apps/mini-app/tests/jest.config.js`

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.js'],
  moduleFileExtensions: ['ts', 'js'],
};
```

### 运行测试

```bash
# 运行所有测试
cd apps/mini-app && npx jest tests --config tests/jest.config.js

# 监视模式（自动重跑）
cd apps/mini-app && npx jest tests --config tests/jest.config.js --watch

# 运行特定测试文件
cd apps/mini-app && npx jest tests/device.test.ts --config tests/jest.config.js
```

---

## 常见陷阱

### ❌ 陷阱 1：测试实现细节而非行为

```typescript
// ❌ 不好的测试（测试实现细节）
it('should call useState with initial value', () => {
  // 测试了 React 内部实现
});

// ✅ 好的测试（测试行为）
it('should display greeting message when user logs in', () => {
  // 测试用户可见的行为
});
```

### ❌ 陷阱 2：测试过于复杂

```typescript
// ❌ 不好的测试（过于复杂）
it('should handle all cases', () => {
  // 100 行测试代码，多个断言...
});

// ✅ 好的测试（单一职责）
it('should do X', () => { ... });
it('should do Y', () => { ... });
```

### ❌ 陷阱 3：跳过重构步骤

```typescript
// ❌ 不好的做法：GREEN 后直接继续新功能
// 代码堆积，技术债增加

// ✅ 好的做法：GREEN 后立即重构
// 保持代码整洁
```

---

## TDD 与工作流集成

### Git 工作流

```
1. 拉取最新代码
2. 创建功能分支
3. TDD 开发（RED-GREEN-REFACTOR）
4. 本地测试通过
5. 提交代码（遵循 Conventional Commits）
6. 推送并创建 PR
```

### 提交信息规范（Conventional Commits）

```
feat: add device detection utility
fix: resolve canvas layout issue in landscape mode
refactor: simplify detectDevice function
test: add unit tests for device detection
```

---

## 总结

| 阶段 | 目标 | 验证 |
|------|------|------|
| RED | 编写失败测试 | 测试运行失败 |
| GREEN | 最小实现通过测试 | 测试运行通过 |
| REFACTOR | 优化代码 | 测试保持通过 |

**记住：** TDD 不是关于测试，而是关于**设计**。测试只是副产品。

---

## 子代理调度（Superpowers 特有能力）

大型任务需要智能分工，避免主代理上下文过载。

### 调度规则

| 场景 | 工具 | 策略 |
|------|------|------|
| 跨多文件搜索/理解代码 | `Task(code-explorer)` | 单次调用，获取完整结果 |
| 同时修改 3+ 个独立文件 | 并行 `replace_in_file` | 同一批次发出，避免串行 |
| 重构涉及 10+ 文件 | `Task`（团队模式） | 拆成独立子任务，并行推进 |
| 理解项目全局结构 | `Task(code-explorer)` | 任何阶段的起点 |
| 前端+后端同时改 | 并行执行 | 前后端独立，可并行 |

### 反模式（不要这样做）

- ❌ 一个文件一个文件串行读取
- ❌ 先 grep 再 grep 再 grep（应合并为一次正则搜索）
- ❌ 在代码探索阶段手动 read_file 逐个文件读取（交给 code-explorer）
- ❌ 一个 `replace_in_file` 只改一行（20 行内的修改应合并）

### 最佳实践

```
✅ 正确：
  1. Task(code-explorer) → 一次获取全局信息
  2. read_file(3 个目标文件) → 并行
  3. replace_in_file(3 处) → 并行
  4. read_lints → 自检
```
