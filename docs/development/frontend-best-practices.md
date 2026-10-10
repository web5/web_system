# 前端开发最佳实践（web_system）

> 适用：`apps/shell`（基座）+ `apps/portal` / `apps/admin` / `apps/deploy-console` 等 Web 前端工程。
> 技术栈：pnpm workspace monorepo · Vue 3 + TypeScript · Vite · Pinia · ant-design-vue。
> 定位：本文是**工程侧常青规范**。视觉/交互规范看 `docs/ui/design-system.md`、`docs/ui/css-override-rules.md`；
> 登录链路判据看 `specs/shell-login-handoff/page-spec.md`。

---

## 0 结论先行：P0 铁律速查

违反下面任意一条，都会造成「线上静默失效」类事故（不留报错、只是功能不对）。

| # | 铁律 | 违反后果 |
|---|---|---|
| 1 | **401 是登录态的唯一权威判据**，`!!token` 只配做乐观初值 | 僵尸半登录态：左栏「加载失败 + 重试」而非「登录 / 注册」 |
| 2 | 401 的落点是**清凭据**，不是只跳登录页 | 跳过去仍带坏 token → 公开接口继续 401 → 死局 |
| 3 | 清凭据必须**双侧**：磁盘（persist）+ 内存（Pinia） | 只清磁盘 → `isLoggedIn` 仍为 true，界面继续按已登录渲染 |
| 4 | **公开接口显式免挂 `Authorization`** | 坏凭据把「本可自愈的匿名链路」一起拖死（扫码二维码） |
| 5 | 改了 `apps/*` 源码必须**走流水线发布** | 只 push 代码不发布 = 线上纹丝不动 |
| 6 | 改 UI 前**先过原型 / 页面规格**（动作门） | 绕过设计门的实现会被拦或返工 |
| 7 | 每个异步列表/面板必须有**空态 + 错误态 + 加载态**三态 | 失败时无恢复出口，用户只能刷新 |
| 8 | 禁止 `catch {}` 静默吞错（尤其是鉴权/配置类请求） | 故障永久化，刷新也不恢复 |
| 9 | 依赖方向单向：`apps → packages`，**禁止反向或跨 app 直接 import** | 循环依赖 + 构建产物互相污染 |
| 10 | 样式冲突**系统性重构**，不在局部叠 `!important` 补丁 | 补丁越叠越多，最终无人敢动 |

---

## 1 工程结构与依赖方向

```
apps/        shell(基座) · portal · admin · deploy-console · mini-app
packages/    shared · types · ui · shell-loader · agent-core · agent-message · mcp-core · kedou-agent
```

| 规则 | 说明 |
|---|---|
| 单向依赖 | `apps/*` 可以依赖 `packages/*`；`packages/*` **不得** import 任何 `apps/*` |
| 跨 app 禁止直连 | portal 与 admin 之间不得互相 import；共享逻辑下沉到 `packages/shared` 或 `packages/ui` |
| 类型共享 | DTO / 枚举统一放 `packages/types`，前端不重复定义后端结构 |
| 常量共享 | 超时、分页大小等放 `packages/shared`（如 `API_TIMEOUT`），禁止各 app 各写一份 |

**反面**：`packages/agent-core` 里 import `apps/portal/src/...` → 构建环形 + 产物体积翻倍。

---

## 2 组件与视图

### 2.1 UI 动作门（项目特有流程，必守）

改动落到 `apps/*/src/**/*.vue`、`packages/ui/**`、页面级交互时，先取得通行证：

1. 改原型稿（`apps/<app>/prototype/index.html`）或页面规格（`specs/**/page-spec*.md`）并**单独提交**，记下 `Proto: <sha>`；
2. 代码提交 message 带 `Proto: <sha>` + `Design: pass`；
3. 纯行为修复 / 既有状态卡片复用 → 在原型稿里记一行「微调豁免」，不另出独立原型页；
4. 批量机械改动或紧急修复才用 `UI_GATE=off` 豁免。

### 2.2 写法约定

```vue
<script setup lang="ts">
// ✅ props / emits 显式类型化，禁止 any
const props = defineProps<{ ticket?: string; closable?: boolean }>();
const emit = defineEmits<{ (e: 'login-success'): void }>();
</script>
```

| 项 | 要求 |
|---|---|
| 组件职责 | 一个组件一件事；超过 ~300 行的 `.vue` 先拆子组件或 composable |
| 状态机 | 多状态 UI（如扫码 pending/confirmed/expired）用**显式联合类型**收口，禁止散落的 boolean |
| 模板复杂度 | 模板里不写复杂表达式，抽到 `computed` |
| 可访问出口 | 任何错误态都必须给出**可点击的恢复动作**（重试 / 返回 / 刷新），不能只有文案 |

---

## 3 状态管理（Pinia）

```ts
export const useUserStore = defineStore('user', () => { /* setup 写法 */ }, {
  persist: { key: 'user-store', storage: localStorage },
});
```

| 规则 | 说明 |
|---|---|
| persist key 显式命名 | 禁止用默认 key；跨模块/基座读取要能稳定定位（基座靠 `user-store` 判定登录态） |
| 不在 store 里操作 DOM | DOM 副作用放组件或 composable |
| 不在 store 里直接 import 请求层以外的东西形成环 | `request.ts` ↔ `user.ts` 相互 import 会成环 → 用**事件/回调**解耦 |
| `computed` 派生而非重复存字段 | `isLoggedIn = computed(() => !!token.value)`；不要另存一个 `loggedIn` 布尔 |

**解耦范式（已落地）**：`request.ts` 清凭据后 `dispatchEvent(new Event('auth:expired'))`，`stores/user.ts` 监听并 `logout()` 同步内存态。

---

## 4 请求层

统一走 `apps/<app>/src/api/request.ts` 的 axios 实例，禁止组件里裸 `fetch/axios`。

| 规则 | 说明 |
|---|---|
| 统一实例 | baseURL `/api`（走网关），超时取 `API_TIMEOUT` |
| 错误体可读 | `responseType: 'blob'` 时 axios **不解析错误体**，必须把 Blob 读成文本再 JSON 回填，否则真因被吞 |
| 静默开关 | 非关键调用（偏好上报等）标 `silent: true`，只走调用方日志，不弹全局提示 |
| 401 顺序 | **先清凭据 → 再跳登录页**（顺序反了就是死局）；`isRedirecting` 防重入锁要有超时解锁 |
| 公开接口白名单 | 匿名接口（如 `/auth/qrcode/{create,check,oauth-url}`）**不挂 Authorization** |
| 公开鉴权接口 | 登录/注册/刷新接口自身的 401 是「凭据错误」，不弹「登录已过期」、不跳转 |

```ts
// ✅ 401 处理骨架
if (status === 401) {
  if (isPublicAuthRequest(config)) return Promise.reject(error);   // 凭据错误交给上层
  if (!config._retry) { config._retry = true; /* 尝试 refresh 一次 */ }
  if (!isRedirecting) {
    isRedirecting = true;
    setTimeout(() => { isRedirecting = false; }, 60_000);
    clearStoredAuth();          // ① 先清凭据（磁盘 + 广播清内存）
    message.error('登录已过期，请重新登录');
    router.push(`/login?redirect=...`);  // ② 再跳
  }
}
```

---

## 5 登录态与凭据生命周期

微前端下登录态由**三层**判定，三者口径必须一致：

| 层 | 位置 | 职责 |
|---|---|---|
| 基座守卫 | `apps/shell/src/main.ts` `beforeEach` | 只决定「去哪个模块的登录页」，不代劳登录 UI |
| 模块路由守卫 | `apps/<app>/src/router` `meta.requiresAuth` | 模块内页面的准入 |
| 请求层 | `api/request.ts` 401 分支 | 唯一权威判据；负责清凭据 |

| 规则 | 说明 |
|---|---|
| 基座不截胡 | 未登录 → `/<模块>/login?redirect=...`；判不出模块才回落基座 `/login` |
| 模块名动态取 | 从 manifest（`byEnv`/`modules`）取，禁止硬编码名单，新模块自动生效 |
| 防死循环 | 目标登录页 == 当前路径时必须 `next()` 放行 |
| 读取口径统一 | `user-store` 优先；**存在但 token 为空串 = 模块已登出**，不得回落历史 key |
| 脏数据不崩 | `user-store` 是非法 JSON 时解析失败回落，不得抛异常 |

---

## 6 样式

| 规则 | 说明 |
|---|---|
| 用设计 token | 颜色/圆角/间距取自 `docs/ui/design-system.md`，不写魔法值 |
| 覆盖第三方组件 | 遵循 `docs/ui/css-override-rules.md`，集中覆盖而非散点 |
| 冲突处理 | 优先**系统性重构**，不在局部叠 `!important`（记忆里的既有决策） |
| 作用域 | 组件样式 `scoped`；基座提供的全局变量（如 `--site-beian-bar-h`）带 fallback |

---

## 7 性能

| 项 | 做法 |
|---|---|
| 路由懒加载 | 页面一律 `() => import('../views/X.vue')` |
| 微前端 CDN 子集 | 新增组件/图标后必须重建 CDN 子集（`scripts/verify-cdn-subsets.cjs`），否则线上静默不渲染 |
| 大列表 | 分页或虚拟滚动；`watch` 避免 `deep: true` 扫大对象 |
| 轮询 | 串行调度（响应回来再排下一次），带**最大生命周期**兜底停止，禁止裸 `setInterval` |
| 图片/静态资源 | 走 `public/`，不在组件里内联大 base64 |

---

## 8 错误与边界

| 规则 | 说明 |
|---|---|
| 三态齐全 | 每个异步区域都要有 加载（骨架）/ 空 / 错误 三态 |
| 错误要可行动 | 错误态给「重试 / 返回 / 刷新」按钮，说明原因而不是只写「加载失败」 |
| 不静默 | `catch {}` 只允许出现在「明确评估过不影响主流程」的地方，且必须写注释说明为什么 |
| 兜底文案 | 网络错误与业务错误分开提示，不要把 4xx 说成「网络错误」 |

---

## 9 排障方法论

**无痕 vs 非无痕二分法**（最快定位法）：

| 现象 | 结论 | 下一步 |
|---|---|---|
| 无痕对、非无痕错 | **本地持久化状态脏**（token / 偏好 / localStorage） | 查 `localStorage` 键，别急着怀疑代码版本 |
| 两端都错 | 产物/代码问题 | 查版本指针 + 抓包 |
| 产物落后 master | 忘了发布 | 走流水线补发 |

**冒烟验证**：改完鉴权/路由类逻辑，用无头浏览器实跑三类状态——干净态、脏 token 态、双残留态；断言最终 URL、`canvas` 是否存在、4xx 请求清单。纸面推演不算验收。

---

## 10 发布与回滚

| 规则 | 说明 |
|---|---|
| 源码改动必须走流水线 | 前端产物是**版本目录**（`static/modules/<app>/<env>/<commit>/`），只 push 代码线上不动 |
| 指针即回滚 | `deploy_app_env_versions.current_version` 改回上一个 commit 即可，无需重建 |
| 禁止手动 ssh 构建/改代码 | 无版本记录、无审批、无回滚点 |
| 发布后必验 | 比对 dev/prod 指针 + 实跑关键路径 |

---

## 11 提交与评审

| 项 | 约定 |
|---|---|
| UI 类改动 | 原型/规格与代码**分开提交**，代码 message 带 `Proto: <sha>` + `Design: pass` |
| 合并方式 | **merge commit**（非 squash / rebase） |
| CI | 建 PR 后 `--auto` 即可，不要阻塞等待；最后统一对账 `gh pr view --json state` |
| 自检 | 提交前跑类型检查：`npx vue-tsc --noEmit`（仓库未配 ESLint，类型检查是主要门禁） |

---

## 12 附录：事故复盘（2026-10-10，两次同源）

### A. 基座守卫截胡（`a82270f9`）

未登录访问 `/portal/*` 落在**基座老登录页**（纯账密 + alert + 整页刷新），portal 模块的新登录页（扫码 / 注册）永远进不去。

> 关键认知：**不是「没发版」，是「发了也没用」** —— 守卫逻辑决定模块登录页不可达。
> 修：按 manifest 首段判定模块 → `/<模块>/login?redirect=...`；目标==当前则放行；读取口径统一到 `user-store`。

### B. 僵尸半登录态（`f77577ef`）

无痕正常、非无痕无二维码且左栏是「重试」，刷新不恢复。抓包：`/api/auth/qrcode/create` 竟然 401。

```
401 /api/ai-agent/agent/conversations   ← 左栏按「已登录」去拉列表
401 /api/auth/verify
401 /api/auth/refresh
401 /api/auth/qrcode/create             ← 公开接口被挂上坏 token
```

四条串成死局：`!!token` 不校验 → 拦截器无条件挂 token → `fetchUserInfo` catch 静默 → 跳登录页前没清凭据。
修：公开接口免挂 token + `clearStoredAuth()`（磁盘 + 广播清内存）+ 401 先清再跳。

### 通用教训

1. 「登录态」不能只靠本地有 token，401 必须落到清凭据。
2. 公开接口必须显式免挂 Authorization。
3. 清状态要磁盘与内存双侧，漏一侧就是僵尸态。

---

## 13 落地 Checklist（提交前自查）

- [ ] 依赖方向：`apps → packages`，无反向 / 跨 app import
- [ ] 新增异步区域：加载 / 空 / 错误 三态齐全，错误态有可点击恢复动作
- [ ] 无裸 `catch {}`；鉴权类请求失败会清凭据而非静默
- [ ] 新增公开接口已加入免挂 `Authorization` 白名单
- [ ] 新增组件/图标已重建 CDN 子集
- [ ] UI 改动已带 `Proto:` / `Design: pass`，或原型稿已记微调豁免
- [ ] `npx vue-tsc --noEmit` 通过
- [ ] 若改了 `apps/*` 源码：已走流水线发布，并核对 dev/prod 指针
