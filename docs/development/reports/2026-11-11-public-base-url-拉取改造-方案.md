# PUBLIC_BASE_URL 拉取改造方案（2026-11-11）

## 一、根因

公网根地址（`PUBLIC_BASE_URL`）此前由各服务（auth / user / upload）从各自环境变量读取，
用于在返回 avatar 前把落库的相对路径拼成完整 URL。问题是：

- 配置分散在三份 `.env` 里，部署时只要漏配一处，头像域名就静默退回相对路径（或配错），排查困难；
- 没有统一权威源，改动一处要同步改多处，天然漂移；
- 与既有「平台级配置收归 system-service `system_configs` 表」的收口方向不一致。

## 二、方案

将公网根地址收归 system-service 的 `system_configs` 表（key=`public_base_url`，蛇形），
三服务通过 system-service 内部接口拉取（带内存缓存 + env 兜底）：

1. **system-service** 新增内部白名单接口 `internal/settings/public-base-url`：
   `@Public()` + `@UseGuards(InternalGuard)`，只暴露固定键，不做通用 `?key=` 查询
   （对齐 `internal-storage` 的白名单纪律，避免把配置表整体暴露成内部 API）。
2. **shared** 新增 `PublicBaseUrlService`：fetch + 60s 内存缓存 + 5s 超时 + env 兜底，
   失败只 `logger.warn` 不抛错、不中断业务（对齐 `dict-client.service.ts` 范式）。
3. **三服务** `resolveAvatarUrl` 由同步读 env 改为 async 拉取：先取
   `PublicBaseUrlService.resolve()`，再 `resolvePublicUrl(avatar, base)`。
   主源改为 system_configs 表，`PUBLIC_BASE_URL` 降级为「DB 未配时的 env 兜底」。

## 三、微调豁免

微调豁免：bug 修复的架构收尾，非新功能，不改视觉 UI。
