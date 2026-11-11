# 头像公网 URL 全链路修复方案（2026-11-11）

## 一、Bug 根因

1. **头像刷新后不显示**：头像从上传 → 落库 → verify 全链路都存相对路径
   （`/api/uploads/avatars/<file>`，无域名前缀）。DB、网关代理、完整 URL 本身都正常，
   断在**前端渲染**：小程序 `<image src>` 把相对路径按包内资源解析，导致加载失败。
   前端此前靠 `resolveAvatarUrl()` 拼 `api_base`，但用户实测刷新后仍不显示，
   静态分析查不出拼域名失败的根因。
2. **列表一直 loading**：`accessToken` 7 天过期后接口返回 401，前端不自动重新登录，
   请求一直失败，页面卡在 loading 态。

## 二、接线方案

1. **后端 A 方案**：三服务（auth-service / user-service / upload-service）在**返回给前端前**，
   用 `resolvePublicUrl(相对路径, normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL))`
   把 avatar 拼成完整 URL，**DB 仍存相对路径**，只在返回前拼。前端 `resolveAvatarUrl()`
   对 `https://` 开头原样返回，天然兼容，无需改前端。
   - 统一实现收敛在 `@web-system/shared` 的 `public-url.ts`：
     `PUBLIC_BASE_URL_ENV` / `normalizePublicBaseUrl` / `resolvePublicUrl`。
2. **前端 401 静默重登**：`request.ts` 遇到 401 时，若未显式登出、非 silent、存在
   `loginEnsurer` 且当前无并发重登，则静默重登一次（带 `LOGIN_ENSURE_TIMEOUT` 超时兜底），
   成功后用新 token 重试一次；仍失败再走 `handleUnauthorized`。

## 三、微调豁免

微调豁免：bug 修复接线，非新功能，不改视觉 UI。
