# 页面规格：基座未登录路由交接（shell login handoff）

> 原型锚点：`apps/shell/prototype/index.html` → `section[data-dr="login-handoff"]`
> 状态：原型已确认（2026-10-10，人审通过）
> 影响面：`apps/shell/src/main.ts`、`apps/shell/src/auth-storage.ts`（基座，非业务模块）

---

## 1 背景与根因

线上现象：生产 `kedouai.com` 未登录访问 `/portal/*` 落在**基座老登录页**
（纯账密 + `alert` + 整页刷新），portal 模块自己的登录页（账密 + 微信扫码 + 注册）进不去。

根因（实测，非推测）：

| 证据 | 结论 |
|---|---|
| prod/dev 基座产物版本均为 `b94924b3`（`deploy_app_env_versions`，2026-09-30） | 基座产物本身落后于 master（缺 `64992bb1`） |
| prod 产物内含 `se.beforeEach((o,n,r)=>{const l=localStorage.getItem("token");if(o.name!=="Login"&&!l)return r({path:"/login",query:{redirect:o.fullPath}});r()})` | 守卫无条件把未登录打到**基座** `/login` |
| 同版本基座的 `views/Login.vue` 是最早实现；portal 的 `views/Login.vue` 才含扫码 | 截胡 → 登录体验退化为最早版本 |
| portal 登录只写 pinia persist key `user-store`，基座只读历史 `token` | 模块登录后刷新会被基座判为未登录 → 登录死循环 |

即：**不是「代码没发」，而是「发了也没用」**——守卫逻辑决定了模块登录页永远不可达；
同时判定口径不同源会造成登录后仍被踢。两者必须一起修。

## 2 需求（EARS）

- **R1** 当未登录用户访问 `/<模块>/<任意路径>` 且首段命中已注册模块时，基座**应当**跳转到
  `/<模块>/login` 并携带 `redirect=<原路径>`。
- **R2** 当访问路径首段未命中任何已注册模块时，基座**应当**回落跳转 `/login`（基座兜底页）。
- **R3** 当目标登录页**等于**当前路径时，基座**应当**直接放行（不触发重定向）。
- **R4** 当已登录（`token` 存在）时，基座**应当**直接放行任何路径。
- **R5** 基座读取 token / refreshToken 时，**应当**以模块 persist key `user-store` 为第一口径，
  仅在 `user-store` 完全不存在时回落历史 `token` / `refreshToken`。

## 3 验收判据（V）

| # | 判据 | 验证方式 |
|---|---|---|
| V1 | 未登录访问 `/portal/chat` → 落在 `/portal/login?redirect=%2Fportal%2Fchat`，页面为 portal 登录页（含扫码入口） | 浏览器无痕访问 + 元素断言 |
| V2 | 未登录访问 `/admin/xxx` → 落在 `/admin/login` | 同上 |
| V3 | 直接访问 `/portal/login` 无重定向循环（地址不再变化、控制台无 `Detected an infinite redirection` 警告） | 停留 5s 观察 |
| V4 | 在 portal 登录成功后刷新页面，不被基座踢回登录页 | 登录后 F5 |
| V5 | 未登录访问非法路径（首段非模块）→ 基座 `/login` 仍可用 | 访问 `/nope/xxx` |
| V6 | prod 基座产物 bundle 内含新守卫逻辑、不含旧无条件 `next('/login')` | `curl` 产物 + 关键字检索 |
| V7 | prod/dev 的 `deploy_app_env_versions.current_version` == 本次发布 commit | 接口/库查询 |

## 4 边界与反例

- **B1 死循环**：`next()` 到与当前相同路径会无限触发 `beforeEach` → 必须有「目标 == 当前则放行」分支（R3）。
- **B2 脏数据**：`user-store` 是非法 JSON 时，token 读取不得抛异常 → 解析失败回落到历史 key。
- **B3 模块已登出**：`user-store` 存在但 `token` 为空串 → 视为未登录，**不得**回落历史 `token`
  （否则「模块登出后又被旧 token 判为已登录」）。
- **B4 manifest 为空**：gateway 未注入清单时 `knownModuleNames` 为空 → 全部回落基座 `/login`，行为与改前一致。
- **B5 redirect 指向模块**：已停在基座 `/login` 且 `redirect` 指向某模块 → 交给该模块登录页。

## 5 落地文件

| 文件 | 改动 |
|---|---|
| `apps/shell/src/auth-storage.ts` | 新增 `readToken` / `readRefreshToken`（`user-store` 优先），`saveAuth`/`clearAuth` 双写两套存储 |
| `apps/shell/src/main.ts` | 守卫改为「模块登录页优先 + 基座兜底」；axios 拦截器与续期改走统一读取口径 |

## 6 回滚

基座按版本目录加载（`static/modules/shell/<env>/<commit>/`），
回滚 = 把 `deploy_app_env_versions` 的 `current_version` 改回 `b94924b3`，无需重新构建。
