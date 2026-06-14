# AI 对话小程序技术实现文档

## 目录

1. [项目概述](#项目概述)
2. [系统架构](#系统架构)
3. [技术栈](#技术栈)
4. [数据库设计](#数据库设计)
5. [API 接口设计](#api-接口设计)
6. [前端设计](#前端设计)
7. [后端实现](#后端实现)
8. [部署说明](#部署说明)
9. [开发指南](#开发指南)

---

## 项目概述

本项目是一个基于 **Hy3 preview** 大模型的 AI 对话聊天微信小程序，属于 `web_system`  monorepo 项目的一部分。

**核心功能：**
- AI 智能对话（接入 Hy3 preview 大模型）
- 多轮对话上下文管理
- 对话历史记录
- 清空对话记录

**小程序信息：**
- AppID: `wxe7635bce95e7cff0`
- 名称：科豆 AI
- 开发模式：原生微信小程序

---

## 系统架构

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                         用户层                               │
│                 微信小程序 (mini-app)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                       API 网关层                             │
│                   Gateway (Port: 3000)                      │
│                  (路由转发、认证、限流)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ▼                           ▼
┌─────────────────┐         ┌─────────────────┐
│   ai-service    │         │   user-service  │
│   (Port: 3003) │         │   (Port: 3002) │
│   AI 对话服务    │         │   用户服务       │
└────────┬────────┘         └─────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│         Hy3 preview API                     │
│   https://wcode.net/api/gpt/v1             │
│   (腾讯混元大模型)                           │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│     数据库       │
│  PostgreSQL     │
│  (对话历史存储)  │
└─────────────────┘
```

### 数据流

1. 用户在小程序输入消息
2. 小程序调用 Gateway API (`/ai/chat`)
3. Gateway 转发请求到 ai-service
4. ai-service 调用 Hy3 preview API
5. ai-service 保存对话记录到数据库
6. 返回 AI 回复给小程序
7. 小程序展示对话内容

---

## 技术栈

### 后端
| 技术 | 版本 | 用途 |
|------|------|------|
| NestJS | ^10.0 | Web 框架 |
| TypeScript | ^5.0 | 开发语言 |
| Axios | ^1.6 | HTTP 客户端 |
| TypeORM | ^0.3 | ORM 框架 |
| PostgreSQL | 15+ | 数据库 |
| class-validator | ^0.14 | 参数校验 |

### 前端（微信小程序）
| 技术 | 版本 | 用途 |
|------|------|------|
| 微信小程序原生 | - | 开发框架 |
| WeUI | ^2.5 | UI 组件库（可选） |

### 基础设施
| 技术 | 版本 | 用途 |
|------|------|------|
| Docker | - | 容器化 |
| Docker Compose | - | 多容器编排 |
| Nginx | - | 反向代理 |
| Rush | 5.133.0 | Monorepo 管理 |
| pnpm | 9.15.0 | 包管理器 |

---

## 数据库设计

### 表：conversations（对话表）

```sql
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,           -- 用户标识（微信 openid）
    title VARCHAR(255),                      -- 对话标题（取第一条消息）
    messages JSONB NOT NULL,                 -- 消息列表（JSON 格式）
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**messages 字段格式：**
```json
[
  {
    "role": "user",
    "content": "你好",
    "timestamp": "2026-05-08T00:00:00Z"
  },
  {
    "role": "assistant",
    "content": "你好！我是混元...",
    "timestamp": "2026-05-08T00:00:05Z"
  }
]
```

### 索引
```sql
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);
```

---

## API 接口设计

### 基础信息
- **基础路径（小程序调用）**：`https://portal.kedouai.com/ai`
- **基础路径（内部服务）**：`http://ai-service:3003`
- **认证方式**：Bearer Token（JWT）

### 接口列表

#### 1. 发送消息（AI 对话）

**请求：**
```
POST /ai/chat
Content-Type: application/json
Authorization: Bearer <token>

{
  "message": "你好",
  "conversationId": "uuid-optional",  // 可选，存在则追加到现有对话
  "messages": [                       // 可选，客户端维护的历史消息
    {"role": "user", "content": "上次的问题"},
    {"role": "assistant", "content": "上次的回答"}
  ]
}
```

**响应：**
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "conversationId": "uuid",
    "reply": "你好！我是混元，很高兴为你服务...",
    "timestamp": "2026-05-08T00:00:05Z"
  }
}
```

#### 2. 获取对话列表

**请求：**
```
GET /ai/conversations?page=1&limit=20
Authorization: Bearer <token>
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": "uuid",
        "title": "你好",
        "updatedAt": "2026-05-08T00:00:00Z",
        "messageCount": 5
      }
    ],
    "total": 100
  }
}
```

#### 3. 获取对话详情

**请求：**
```
GET /ai/conversations/:id
Authorization: Bearer <token>
```

**响应：**
```json
{
  "code": 0,
  "data": {
    "id": "uuid",
    "title": "你好",
    "messages": [...],
    "createdAt": "2026-05-08T00:00:00Z",
    "updatedAt": "2026-05-08T00:05:00Z"
  }
}
```

#### 4. 删除对话

**请求：**
```
DELETE /ai/conversations/:id
Authorization: Bearer <token>
```

**响应：**
```json
{
  "code": 0,
  "message": "删除成功"
}
```

#### 5. 清空所有对话

**请求：**
```
DELETE /ai/conversations
Authorization: Bearer <token>
```

---

## 前端设计

### 页面结构

```
pages/
├── index/              # 对话列表页
│   ├── index.js
│   ├── index.wxml      # 展示所有对话记录
│   └── index.wxss
└── chat/               # 对话详情页（核心）
    ├── chat.js         # 处理逻辑
    ├── chat.wxml      # 对话界面
    └── chat.wxss      # 样式
```

### 对话页面设计（chat.wxml）

```xml
<view class="chat-container">
  <!-- 消息列表 -->
  <scroll-view 
    scroll-y 
    class="message-list"
    scroll-into-view="{{scrollToMessage}}"
  >
    <view 
      wx:for="{{messages}}" 
      wx:key="index"
      id="msg-{{index}}"
      class="message-item {{item.role === 'user' ? 'user' : 'assistant'}}"
    >
      <view class="avatar">
        <image src="{{item.role === 'user' ? userAvatar : aiAvatar}}" />
      </view>
      <view class="content">
        <text>{{item.content}}</text>
      </view>
    </view>
    
    <!-- 加载中动画 -->
    <view wx:if="{{loading}}" class="loading">
      <view class="dot-flashing"></view>
    </view>
  </scroll-view>

  <!-- 输入框 -->
  <view class="input-area">
    <input 
      value="{{inputValue}}"
      bindinput="onInput"
      bindconfirm="onSend"
      placeholder="输入消息..."
      disabled="{{loading}}"
    />
    <button bindtap="onSend" disabled="{{loading || !inputValue}}">发送</button>
  </view>
</view>
```

### 样式设计（chat.wxss）

```css
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.message-list {
  flex: 1;
  padding: 20rpx;
  overflow-y: auto;
}

.message-item {
  display: flex;
  margin-bottom: 30rpx;
}

.message-item.user {
  flex-direction: row-reverse;
}

.message-item .content {
  max-width: 70%;
  padding: 20rpx;
  border-radius: 10rpx;
  background: #f0f0f0;
}

.message-item.user .content {
  background: #07c160;
  color: white;
}

.input-area {
  display: flex;
  padding: 20rpx;
  border-top: 1px solid #eee;
}

.input-area input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 5px;
  padding: 10rpx;
}

.input-area button {
  margin-left: 20rpx;
  background: #07c160;
  color: white;
}
```

### 逻辑实现（chat.js）

```javascript
Page({
  data: {
    messages: [],
    inputValue: '',
    loading: false,
    conversationId: null
  },

  onLoad(options) {
    if (options.id) {
      this.loadConversation(options.id);
    }
  },

  // 加载对话历史
  async loadConversation(id) {
    const res = await wx.request({
      url: `${BASE_URL}/ai/conversations/${id}`,
      method: 'GET',
      header: {
        'Authorization': `Bearer ${getToken()}`
      }
    });
    this.setData({
      conversationId: id,
      messages: res.data.data.messages
    });
  },

  // 发送消息
  async onSend() {
    const { inputValue, messages, conversationId } = this.data;
    if (!inputValue.trim() || this.data.loading) return;

    // 添加用户消息到列表
    const newMessages = [...messages, {
      role: 'user',
      content: inputValue,
      timestamp: new Date().toISOString()
    }];

    this.setData({
      messages: newMessages,
      inputValue: '',
      loading: true
    });

    try {
      // 调用 API
      const res = await wx.request({
        url: `${BASE_URL}/ai/chat`,
        method: 'POST',
        header: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        data: {
          message: inputValue,
          conversationId,
          messages: newMessages.slice(-10)  // 只发送最近10条消息作为上下文
        }
      });

      // 添加 AI 回复到列表
      this.setData({
        messages: [...newMessages, {
          role: 'assistant',
          content: res.data.data.reply,
          timestamp: res.data.data.timestamp
        }],
        conversationId: res.data.data.conversationId,
        loading: false
      });
    } catch (error) {
      wx.showToast({
        title: '发送失败',
        icon: 'error'
      });
      this.setData({ loading: false });
    }
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  }
});
```

---

## 后端实现

### ai-service 目录结构

```
servers/ai-service/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── ai/
│   │   ├── ai.module.ts
│   │   ├── ai.service.ts
│   │   ├── ai.controller.ts
│   │   └── dto/
│   │       ├── chat.dto.ts
│   │       └── conversation.dto.ts
│   ├── config/
│   │   └── hy3.config.ts
│   └── common/
│       └── http/
│           └── hy3.client.ts
├── package.json
├── tsconfig.json
├── nest-cli.json
└── .env.example
```

### Hy3 Client 实现

```typescript
// src/common/http/hy3.client.ts
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class Hy3Client {
  private readonly logger = new Logger(Hy3Client.name);
  private readonly client: AxiosInstance;
  private readonly baseUrl = process.env.HY3_BASE_URL || 'https://wcode.net/api/gpt/v1';
  private readonly apiKey = process.env.HY3_API_KEY;

  constructor() {
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async chat(messages: Array<{role: string, content: string}>, options?: {
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    try {
      const response = await this.client.post('/chat/completions', {
        model: 'tencent/hy3-preview',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 2000
      });

      return response.data.choices[0].message.content;
    } catch (error) {
      this.logger.error(`Hy3 API error: ${error.message}`);
      throw new Error('AI 服务调用失败');
    }
  }
}
```

### AI Controller 实现

```typescript
// src/ai/ai.controller.ts
import { Controller, Post, Body, Get, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ChatDto } from './dto/chat.dto';

@ApiTags('AI 对话')
@Controller('ai')
@ApiBearerAuth()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  @ApiOperation({ summary: '发送消息并获取 AI 回复' })
  async chat(@Body() chatDto: ChatDto) {
    const reply = await this.aiService.chat(chatDto);
    return {
      code: 0,
      message: 'success',
      data: reply
    };
  }

  @Get('conversations')
  @ApiOperation({ summary: '获取对话列表' })
  async getConversations() {
    return this.aiService.getConversations();
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '获取对话详情' })
  async getConversation(@Param('id') id: string) {
    return this.aiService.getConversation(id);
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除对话' })
  async deleteConversation(@Param('id') id: string) {
    await this.aiService.deleteConversation(id);
    return { code: 0, message: '删除成功' };
  }
}
```

---

## 部署说明

### 开发环境

1. **安装依赖**
```bash
cd /Users/geekwen/workspace/web_system
rush update
```

2. **启动后端服务**
```bash
# 启动数据库和 Redis
docker-compose up -d postgres redis

# 启动 ai-service
cd servers/ai-service
pnpm run start:dev
```

3. **启动小程序**
- 打开微信开发者工具
- 导入项目：`/Users/geekwen/workspace/web_system/apps/mini-app`
- 配置 AppID：`wxe7635bce95e7cff0`

### 生产环境

1. **构建 Docker 镜像**
```bash
docker build -t web-system/ai-service:latest servers/ai-service
```

2. **更新 docker-compose.yml**
```yaml
services:
  ai-service:
    build: ./servers/ai-service
    ports:
      - "3003:3003"
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/web_system
      - HY3_API_KEY=${HY3_API_KEY}
      - HY3_BASE_URL=https://wcode.net/api/gpt/v1
    depends_on:
      - postgres
    networks:
      - web_network
```

3. **部署**
```bash
docker-compose up -d ai-service
```

---

## 开发指南

### 获取 Hy3 API Key

1. 访问 https://platform.wcode.net
2. 注册账号并登录
3. 创建 API Key
4. 将 API Key 配置到环境变量 `HY3_API_KEY`

### 小程序域名配置

登录微信公众平台，在「开发」->「开发管理」->「开发设置」->「服务器域名」中添加：

- request 合法域名：`https://portal.kedouai.com`

### 测试流程

1. **单元测试**（后端）
```bash
cd servers/ai-service
pnpm run test
```

2. **接口测试**
```bash
# 使用 curl 测试
curl -X POST https://portal.kedouai.com/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"message": "你好"}'
```

3. **小程序预览**
- 在微信开发者工具中点击「预览」
- 使用微信扫码在真机上测试

---

## 注意事项

1. **API Key 安全**
   - 不要将 API Key 提交到代码仓库
   - 使用环境变量或配置文件（添加到 .gitignore）

2. **错误处理**
   - 小程序端需要妥善处理网络错误、超时、API 限流等情况
   - 后端需要添加重试机制和熔断器

3. **成本控制**
   - Hy3 preview 按 token 计费
   - 建议限制单轮对话的最大 token 数
   - 可考虑添加用户配额限制

4. **内容安全**
   - 小程序上线需要通过微信审核
   - 建议接入微信内容安全 API 进行消息过滤
   - 遵守《生成式人工智能服务管理暂行办法》

5. **性能优化**
   - 使用流式响应（Stream）提升用户体验
   - 对话历史分页加载
   - 图片等资源使用 CDN 加速

---

## 附录

### 相关文档链接

- Hy3 preview API 文档：https://wcode.net/model/hy3-preview
- 微信小程序开发文档：https://developers.weixin.qq.com/miniprogram/dev/framework/
- NestJS 官方文档：https://docs.nestjs.com/
- TypeORM 文档：https://typeorm.io/

### 联系方式

如有问题，请联系项目负责人：橙子哥哥（geekwen）

---

*文档版本：v1.0*
*最后更新：2026-05-08*
