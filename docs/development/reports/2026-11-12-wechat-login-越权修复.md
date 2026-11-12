# wechat-login 任意假 code 越权拿 token 修复方案

- 日期：2026-11-12
- 分支：`fix/wechat-login-openid-guard`
- 级别：**P0 安全**（公网实测复现：任意假 code → 200 + admin token）
- 流程凭证：`Plan: pass`（本报告即 R18 研发方案凭证；行为变化属安全修复，不适用微调豁免）

## 1. 需求背景

公网实测复现：向 wechat-login 传任意假 code，接口返回 200 并签发 admin 的 access token —— 未授权攻击者可直接拿到后台凭证。

根因是两处缺陷叠加：

1. `auth.service.ts` `wechatLogin` 调 `sns/oauth2/access_token` 后**未判 errcode**：code 无效时微信返回 `{errcode: 40029, ...}`，`access_token` / `openid` 均为 `undefined`，流程却继续往下走。
2. `user.service.ts` `findByOaOpenid(undefined)` 触发 **TypeORM undefined-where 静默忽略**：值为 `undefined` 的 where 条件被丢弃，查询退化为无条件 `findOne`，返回 users 表第一行（恰好是 admin），随后为其签发 token。

## 2. 方案设计

统一加两道闸：①微信响应判 `errcode` + `openid`/`access_token` 非空（fail-closed，缺任一直接 4xx）；②仓储层兜底，openid 为空绝不下发查询。写法参照既有样板 `wechat-mp.service.ts:64`（判 access_token 缺失）、`:84`（判 errcode）、`:93`（判返回字段缺失）。

| # | 位置 | 防护 |
|---|---|---|
| 1 | `auth.service.ts` `wechatLogin`（:122 附近） | 判 errcode；判 `access_token` + `openid` 非空，否则 BadRequestException，不进 findByOaOpenid |
| 2 | `auth.service.ts` `miniprogramLogin`（:166 附近） | 已有 errcode 判断，补 openid 判空 |
| 3 | `auth.service.ts` `bindMpOpenid`（:504 附近） | 已有 errcode 判断，补 openid 判空 |
| 4 | `auth.service.ts` `bindOaOpenid`（:520 附近） | 已有 errcode 判断，补 openid 判空 |
| 5 | `qrcode.service.ts` `confirmScan`（:120 附近） | 已有 errcode 判断，补 openid 判空 |
| 6 | `user.service.ts` `findByMpOpenid`(:31) / `findByOaOpenid`(:38) | 仓储层兜底：openid 为空（undefined/null/''）直接抛 BadRequestException，绝不下发 TypeORM 查询 |

九子项其余维度（页面 / 接口 / 数据结构 / 配置 / 依赖 / 初始化数据 / 权限模型 / 接口设计约束）：全部为**无变更**——纯服务内异常路径防护，无新接口、无 DDL、无配置、无菜单、无权限规则变化。

## 3. 影响面与回归风险

只影响**异常路径**：errcode 非 0 或 openid 缺失/为空时，行为从「误放行 + 签发 token」变为「4xx 拒绝」。正常登录路径（真实 code → 真实 openid）行为不变。

| 场景 | 修前 | 修后 |
|---|---|---|
| 假 code 调 wechat-login | 200 + admin token | 4xx，无 token |
| 假 code 调 miniprogramLogin / confirmScan / bind* | 可能放行或绑定 undefined | 4xx |
| 正常微信登录 / 绑定 | 正常 | 不变（存量用例回归保证） |

回归保障：16 个新用例已先行（TDD red，覆盖上述全部异常分支），存量 auth/qrcode/user spec 全量回归。

## 4. 发布清单

- 服务：**auth-service 单服务**，无 DB 变更、无配置变更、无菜单变更。
- 发布动作：合并 master 后走标准发布链路，重启 auth-service 即生效。

## 5. 验收标准

1. 16 个新用例 + 存量用例全绿；
2. `tsc` 编译通过；
3. 发布后公网 curl 假 code 验证：返回 4xx 且响应体无 token（验证记录登记台账 8759）。

## 6. 回滚方案

单 commit 修复，回滚 = `git revert` 该 commit 后走标准链路重启 auth-service。无 DB / 配置变更，无不可回滚项。

## 7. 监控

发布后观察 auth-service error log：关注 BadRequestException（微信登录失败）频率，正常应仅为真实无效 code 的低频 noise；若出现尖刺说明微信侧或配置异常。

## 8. 排期

P0 安全修复，立即执行：文档 → 实现 → 测试 → PR → 合并发布，当日完成。

## 9. 责任人

- 修复与测试：rd-engineer
- 发布与发布后验证（台账 8759）：rd-releaser
