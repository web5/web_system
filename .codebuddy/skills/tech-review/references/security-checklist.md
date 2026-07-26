# 安全审查清单

> 每次做架构/API/部署相关改动时，对照此清单逐项检查。

## 认证与授权

- [ ] 是否需要登录？→ 如需，使用 JWT + 网关统一验证
- [ ] 是否需要角色权限？→ 如需，定义 RBAC 模型（admin / user）
- [ ] Token 有效期是否合理？→ 默认 7 天 access + 30 天 refresh
- [ ] 是否支持第三方登录？→ 微信 OAuth / 小程序登录
- [ ] 登出是否使 Token 失效？→ Redis 黑名单机制
- [ ] accessToken 和 refreshToken 是否用 `type` 字段区分？

## 数据安全

- [ ] 密码是否加密存储？→ 必须 bcrypt hash
- [ ] 手机号/邮箱是否脱敏展示？→ 前3后4
- [ ] 敏感配置是否加密？→ SMTP 密码、AK/SK 等不入代码库
- [ ] 是否有 SQL 注入防护？→ TypeORM 参数化查询
- [ ] 是否有 XSS 防护？→ Vue 默认转义
- [ ] 异常过滤器是否在生产环境泄露内部错误信息？→ 非 HttpException 返回通用提示

## API 安全

- [ ] 是否有限流措施？→ 网关层限流，health 端点例外
- [ ] 是否有操作日志？→ 关键操作（登录/修改/删除）记录
- [ ] 是否有请求大小限制？→ 上传文件限制 MB
- [ ] CORS 是否配置了具体域名白名单？→ 禁止回退到 `*`
- [ ] 所有 Controller 输入是否使用了 class-validator DTO？→ 禁止 `Record<string, string>` 裸类型

## HTTP 安全

- [ ] 是否启用了 Helmet？→ X-Frame-Options, X-Content-Type-Options, HSTS 等
- [ ] 是否配置了 CSP 头？→ Content-Security-Policy 限制脚本/样式/字体来源
- [ ] JWT_SECRET 是否在启动时做了非空校验？→ 空值时进程拒绝启动
- [ ] 是否使用结构化 Logger 而非 console.log？→ NestJS Logger

## 运维安全

- [ ] 是否有健康检查？→ /health 端点，跳过限流
- [ ] 数据库端口是否暴露公网？→ 必须仅内网访问
- [ ] Redis 端口是否暴露公网？→ 生产环境仅 `127.0.0.1` 或仅内网
- [ ] 是否有备份策略？→ 每日自动备份
- [ ] 是否有 .dockerignore？→ 排除 node_modules, .git, .env*, dist
- [ ] PM2 或 Docker healthcheck 是否配置？→ postgres: pg_isready, redis: ping
