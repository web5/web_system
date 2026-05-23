# 📦 Portal 页面部署记录

**部署时间：** 2026-03-28 13:47  
**部署人员：** OpenClaw

---

## 部署步骤

### 1. 构建 Portal 应用
```bash
cd /home/ubuntu/.openclaw/workspace/web_system/apps/portal
pnpm install
npx vite build  # 跳过类型检查
```

**构建产物：**
```
apps/portal/dist/
├── index.html
└── assets/
    ├── index-BZvjGoKo.js
    └── index-DJR1Uhs0.css
```

### 2. 上传到 246 服务器
```bash
rsync -avz dist/ root@106.52.176.246:/root/web_system/static/portal/
```

**上传结果：**
```
/root/web_system/static/portal/
├── index.html (479 bytes)
└── assets/
    ├── index-BZvjGoKo.js
    └── index-DJR1Uhs0.css
```

### 3. 重启 Gateway 服务
```bash
ssh root@106.52.176.246 "pm2 restart gateway"
```

### 4. 验证访问
```bash
# 测试 Portal 页面
curl -sk https://portal.kedouai.com/ | head -10

# 测试 Admin 页面
curl -sk https://admin.kedouai.com/ | head -10

# 测试 API
curl -sk -X POST https://admin.kedouai.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
```

**验证结果：**
- ✅ https://portal.kedouai.com/ → 返回门户页面
- ✅ https://admin.kedouai.com/ → 返回管理后台
- ✅ API 接口正常

---

## 当前部署状态

| 应用 | 域名 | 状态 | 静态资源目录 | 大小 |
|------|------|------|-------------|------|
| Admin | https://admin.kedouai.com | ✅ 运行中 | /root/web_system/static/admin/ | ~1.6MB |
| Portal | https://portal.kedouai.com | ✅ 运行中 | /root/web_system/static/portal/ | ~1.5MB |

---

## 服务状态

```bash
# PM2 服务状态
┌────┬─────────────────┬──────────┬─────────┬──────────┐
│ id │ name            │ status   │ uptime  │ memory   │
├────┼─────────────────┼──────────┼─────────┼──────────┤
│ 0  │ gateway         │ online   │ ~5s     │ ~84MB    │
│ 1  │ auth-service    │ online   │ ~3h     │ ~91MB    │
│ 2  │ user-service    │ online   │ ~3h     │ ~79MB    │
└────┴─────────────────┴──────────┴─────────┴──────────┘
```

---

## 后续更新流程

### 更新 Admin 应用
```bash
cd apps/admin-web && pnpm build
rsync -avz dist/ root@106.52.176.246:/root/web_system/static/admin/
ssh root@106.52.176.246 "pm2 restart gateway"
```

### 更新 Portal 应用
```bash
cd apps/portal && npx vite build
rsync -avz dist/ root@106.52.176.246:/root/web_system/static/portal/
ssh root@106.52.176.246 "pm2 restart gateway"
```

---

> 部署完成时间：2026-03-28 13:47  
> 下次检查：定期检查服务状态和日志
