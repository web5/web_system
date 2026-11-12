# 绑定邮箱 400 message='success' 根因修复方案（信封契约错位）

- 日期：2026-11-12
- 服务：auth-service（`servers/auth-service`）
- 分支：`fix/auth-email-verify-envelope-20261112`
- 诊断来源：rd-debugger 实锤（本文档仅落结论，不重复调研）

## 1. 现象

dev 环境绑定邮箱 100% 失败：用户输入正确验证码提交后，前端红字提示英文 `success`；dev 日志三次 400 实锤（8:02 / 8:46 / 8:58）。且 user-service 侧验证码已核销，用户只能重新发码循环。

## 2. 根因

auth-service `src/account/account.service.ts` 的 `verifyEmailCodeWithUserService` 用 axios 直连 user-service `POST /internal/users/email/verify`，预期裸返回 `{ok:true}`。但 user-service 有全局 `TransformInterceptor`，把 2xx 成功响应统一包成 `{code:0, data:{...}, message:'success'}`。auth-service 第 141 行 `if (!data?.ok)` 读到的是信封外层的 `data.ok` = undefined → 恒抛 `BadRequestException(data.message)`，而信封外层 `message` 固定为 `'success'` → 前端透出英文 success。

错误体（4xx）由 user-service `AllExceptionsFilter` 产出、**不经**信封拦截器，故 catch 分支 `err.response.data?.message` 取值本来就正确，无需改动。

## 3. 方案（用户已拍板方案 A：最小爆炸半径，只改 auth-service）

`verifyEmailCodeWithUserService` 成功路径解信封，兼容两种形态：

```ts
const payload = data && typeof data === 'object' && 'data' in data ? (data as any).data : data;
if (!payload?.ok) throw new BadRequestException(payload?.message || '验证码错误或已过期');
```

- 带信封（现网）：取 `data.data`；
- 裸返回（未来若拦截器摘除）：原样使用；
- 错误分支不动。

## 4. 影响面

- 仅 auth-service 单文件 `src/account/account.service.ts`。
- internal 其他调用点排查结论：auth-service 内 axios 调用仅 `account.service.ts:135` 一处指向 user-service `/internal/*`；`wechat-mp.service.ts`、`auth.service.ts`、`qrcode.service.ts` 的 axios 均调微信开放平台（api.weixin.qq.com），不经 user-service 信封，无同类问题。

## 5. 验证判据

- V1：`account.service.spec.ts` 新增三形态单测全绿 —— ①信封 `{code:0,data:{ok:true},message:'success'}` 通过不抛；②信封 `{code:0,data:{ok:false,message:'验证码错误或已过期'}}` 抛中文文案；③裸 `{ok:true}` 通过（向后兼容）。
- V2：auth-service `tsc --noEmit` typecheck 绿；auth-service jest 全绿。
- V3（部署后，由 rd-releaser 执行）：dev 发码 → 绑定返回 200 且 users 表 email 写入。
- V4（部署后）：故意输错验证码，前端显示中文「验证码错误或已过期」而非英文 success。

## 6. 用户确认

2026-11-12 用户回复「按推荐来」，即确认采用方案 A（只改 auth-service、不动 user-service 拦截器）。

## 7. 发布口径

本 PR 只合代码，**不部署**；dev/prod 部署由 rd-releaser 另行执行。
