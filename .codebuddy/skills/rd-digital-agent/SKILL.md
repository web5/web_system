---
name: rd-digital-agent
description: 研发数字人技能包 - 专为 web_system 全栈项目打造的 AI 研发助手。当用户需要执行 TDD 开发、修复 Bug、添加功能、理解项目结构或遵循项目规范时，使用此技能。触发关键词：TDD、测试驱动、修复、添加功能、项目结构、开发规范。
---

# 研发数字人 (R&D Digital Agent)

## 概述

此技能包为 web_system 全栈 monorepo 项目提供专业的 AI 研发助手能力。支持 TDD（测试驱动开发）流程、多子项目管理、代码规范检查等核心研发活动。

## 核心能力

### 1. TDD 开发流程

遵循"红-绿-重构"循环：

1. **RED** - 先编写失败的测试
2. **GREEN** - 编写最少代码让测试通过
3. **REFACTOR** - 重构代码保持整洁

触发条件：用户提到"TDD"、"测试驱动"、"先写测试"等关键词。

**工作流程：**

```
1. 理解需求 → 编写测试用例（测试先失败）
2. 实现最小可用代码 → 测试通过
3. 重构优化 → 测试保持通过
4. 提交代码
```

### 2. 项目结构理解

自动识别并遵循 web_system 的 monorepo 结构：

```
web_system/
├── apps/                    # 前端应用
│   ├── admin-web/          # 管理后台 (Vue3 + Ant Design Vue)
│   ├── portal/             # 少儿教育门户 (Vue3 + Ant Design Vue)
│   └── mini-app/           # 微信小程序 (TypeScript)
├── servers/                 # 后端服务 (NestJS + TypeORM + PostgreSQL)
│   ├── gateway/            # API 网关
│   ├── auth-service/       # 认证服务
│   └── user-service/       # 用户服务
├── packages/                # 共享包
│   ├── types/              # TypeScript 类型定义
│   └── shared/             # 共享工具函数
└── common/                  # 公共配置
```

**子项目技术栈：**

| 子项目 | 技术栈 | 端口 | 包管理命令 |
|--------|--------|------|-----------|
| admin-web | Vue3 + Vite + Pinia | 5173 | `rushx dev` |
| portal | Vue3 + Vite + Ant Design Vue | 3003 | `rushx dev` |
| mini-app | 微信小程序 + TypeScript | - | `rushx dev` (预览) |
| gateway | NestJS + TypeORM | 3000 | `rushx dev` |
| auth-service | NestJS + JWT | 3001 | `rushx dev` |
| user-service | NestJS + PostgreSQL | 3002 | `rushx dev` |

### 3. 开发规范执行

**代码规范：**
- 使用 TypeScript（严格模式）
- 遵循 ESLint 规则
- 提交前运行测试
- 使用 pnpm 管理依赖（Rush monorepo）

**Git 规范：**
- 分支：master（主分支）
- 提交信息：遵循 Conventional Commits
- 不主动提交代码，除非用户明确要求

**API 规范：**
- 后端服务使用 NestJS 框架
- RESTful API 设计
- 网关统一路由：`/api/*` → 各微服务

### 4. 常见任务处理

**添加新功能：**
1. 理解需求（询问澄清 if needed）
2. 编写测试用例（TDD）
3. 实现功能代码
4. 更新相关文档
5. 运行测试验证

**修复 Bug：**
1. 定位问题代码
2. 编写复现测试（测试失败）
3. 修复代码（测试通过）
4. 验证修复

**代码重构：**
1. 确保有测试覆盖
2. 小步重构
3. 持续运行测试

## 工作流程决策树

```
用户请求
  │
  ├─ 提到 "TDD" / "测试驱动" → 启动 TDD 流程（先写测试）
  │
  ├─ 提到 "修复" / "Bug" → Bug 修复流程（先写复现测试）
  │
  ├─ 提到 "添加" / "新功能" → 功能开发流程（TDD）
  │
  ├─ 提到 "重构" / "优化" → 重构流程（确保测试覆盖）
  │
  └─ 其他 → 分析需求，选择合适的流程
```

## 使用参考文档

此技能包包含以下参考文档（按需加载到上下文）：

- **`references/project-structure.md`** - 详细项目结构、端口分配、依赖关系
- **`references/tdd-workflow.md`** - TDD 最佳实践、测试编写指南
- **`references/coding-standards.md`** - 代码规范、命名约定、文件组织

## 资源说明

### references/

包含详细的项目文档和开发指南，根据需要加载到上下文。

### scripts/

（可选）包含可执行的自动化脚本，如测试初始化、项目脚手架等。

### assets/

（可选）包含代码模板、配置文件模板等。

---

**注意：** 此技能包专为 web_system 项目定制。在其他项目中使用时，需要先了解新项目的结构和规范。
