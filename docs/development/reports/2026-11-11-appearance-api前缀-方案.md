# appearance 界面偏好接口漏 /api 前缀修复方案（2026-11-11）

## 一、根因

`apps/dachengzi-minigram/utils/appearance.ts` 两处调用漏写 `/api` 前缀：

- `:85` `get<WrappedMe>('/users/me')`（`applyFromServer`，每次启动登录就绪后由 app.ts:54 触发）
- `:69` `request({ url: '/users/me', method: 'PUT', ... })`（`pushToServer`，切换圆角风格时）

实际发出 URL = `https://dev.kedouai.com/users/me`。网关 SPA 兜底（dist/main.js：
仅 GET、非 /api/docs/health 等白名单前缀）对未命中 GET 返回 200 + shell/index.html，
导致 devtools Network 出现「me → 200 text/html（壳）」的诡异请求（2026-11-11 实测）。
因响应是 HTML 字符串而非错误信封，2xx 判据当成功吞掉，`applyFromServer` 解析不到
preferences 静默保持本地值——功能表面无害，但界面偏好从未真正跟账号同步，且每次
启动白打一次错误请求。

后端正确全路径是 `/api/users/me`（user.controller `@Controller('users')` + `@Get('me')`，
account.ts:79 updateProfile 即用此路径，工作正常）。成因：照 portal ui-prefs 口径
抄路径时漏了 /api 前缀。

## 二、方案

1. `appearance.ts:69/:85` 两处 URL 补 `/api` 前缀 → `/api/users/me`。
2. **request 层加不变量断言**（防整类回归）：`utils/request.ts request()` 入口断言
   `options.url` 必须以 `/api/` 开头，否则 throw + console.error。修复后封装层全部
   现存调用点均满足该不变量；auth/tts/agent-stream 三处直连 wx.request 不经封装、
   不受断言影响（其 URL 常量均带 /api，合规）。

## 三、微调豁免

微调豁免：bug 修复，非新功能，不改视觉 UI。
