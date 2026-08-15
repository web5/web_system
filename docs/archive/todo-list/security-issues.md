# 安全问题待办清单

> 最后更新: 2026-07-26

---

## ✅ 已修复

| 序号 | 问题 | 修复方式 |
|------|------|---------|
| 1 | `.env` 文件泄露到 Git | `.gitignore` 改为 `**/.env*`，允许 `!.env.example` |
| 2 | `docker-compose.yml` 硬编码密码 | 改为 `${POSTGRES_PASSWORD}` 环境变量 |
| 3 | `docker-compose.prod.yml` 硬编码密码和 JWT Secret | 改为 `${DB_PASSWORD}` / `${JWT_SECRET}` |
| 4 | `upload-service/auth.guard.ts` 硬编码回退 JWT Secret | 移除回退值，未设置环境变量时直接报错 |
| 5 | `auth-service/seed.ts` 硬编码默认密码 `admin123` / `test123` | 改为必须通过环境变量指定 |
| 6 | `todo-service` SQL 注入风险 (`sortBy` 参数) | 加入字段白名单校验 |
| 7 | 缺少 API 速率限制 | Gateway 集成 `@nestjs/throttler`，每 IP 每分钟 100 次 |
| 8 | CORS 通配符 `*` | `docker-compose.prod.yml` 改为具体域名；`gateway/auth/todo` 的 main.ts 默认值从 `*` 改为 `''` |
| 9 | Helmet 安全头缺失 | Gateway 安装 `helmet`，启用 X-Frame-Options/X-Content-Type/HSTS 等 |
| 10 | CSP 头缺失 | Helmet 内联配置 Content-Security-Policy（scriptSrc/styleSrc/fontSrc/imgSrc/connectSrc） |
| 11 | system-service 无输入验证 | 创建 `UpdateSettingsDto` 替代 `Record<string, string>`，过滤非 string 值 |
| 12 | 生产环境异常过滤器泄露内部信息 | `auth/user/upload/ai` 四个异常过滤器：生产环境非 HttpException 返回通用"服务器内部错误" |
| 13 | console.log 替换为结构化 Logger | `gateway/auth/todo` 的 main.ts `console.log` → NestJS `Logger.log` |

---

## 全部修复完成 🎉

所有安全问题已修复，无需继续跟进。
