# 契约评审报告 · MCP Key admin 签发端点（PR #255）

阻塞: 0
重要: 2

> 评审角色：`contract-reviewer`（独立第三方）· 判据源 `docs/api/contracts.md`（C1–C6 + §7）
> 评审对象：`ec89e3ad fix(user-service): admin 直接签发 MCP Key 时绑定 ownerId，并补签发端点`
> 分支：`fix/mcp-key-admin-issue` · 日期：2026-10-08
> 范围：仅该提交的 3 个文件。工作区 `?? .codebuddy/skills/wb-auto-deliver/`、`?? specs/auto-deliver/` 为无关改动，**不在评审范围**。
> 结论三态：**⚠️ 有条件通过**（无阻塞项；2 项重要须在合入前或合入后一版内处理）
> 本报告只读代码 + 落盘，未改任何业务代码、未 commit、未连服务器/数据库。

---

## 0. 结论摘要

| 面 | 判定 |
|---|---|
| C1 对外 HTTP 接口（新增 `POST /api/keys/admin`） | ⚠️ 有条件通过 —— **派生契约清单 `specs/user-service/api-design.md` 未随改动重生成**（重要 #1） |
| `adminCreate` 签名变更（新增可选第 3 参） | ✅ 通过 —— 改动前确为死代码，无既有调用方，不构成破坏性变更 |
| 越权面（admin 校验 / roles 形态 / 禁用用户） | ✅ 通过 —— 三种形态均已覆盖，有代码证据 |
| 敏感信息（明文 key 单次返回） | ✅ 通过 —— 与既有 `POST /api/keys/verify` 同约定；新增代码无日志输出 |
| 审计语义（ownerId 必须绑到人） | ⚠️ 判据**成立**，但实现未校验 ownerId 指向的用户存在/active（重要 #2） |
| C3 MCP 工具 | ✅ 未触及（提交面 3 文件全在 `servers/user-service/src/api-key/`） |
| C4 权限码 / 共享常量 | ✅ 未触及（走角色判断，非新增权限码） |
| C5 网关路由 | ✅ 无需改动 —— 既有 `keys/:path(*)` 通配已覆盖 |

**关键澄清（回应"是否需要登记到 `docs/api/contracts.md`"）**：不需要。`contracts.md` §2 的**实际登记粒度是类别级**——它只登记「C1 的真相源 = controller 装饰器、派生清单 = `specs/<svc>/api-design.md`、重生成命令」，**不逐条列举端点**。真正的端点级登记义务落在 `specs/user-service/api-design.md`（git 跟踪、由 `scripts/gen-api-design.mjs` 自动提取）。该文件的粒度是**该服务所有 controller 的全部端点**（含 `InternalKeyController` 的 `/api/internal/keys/verify`），并非"只登记跨服务/网关接口"。因此新端点**必须**出现在该文件中 —— 而它当前缺失。

---

## 1. 改动面

```
$ git log --oneline master..HEAD | head -1
ec89e3ad fix(user-service): admin 直接签发 MCP Key 时绑定 ownerId，并补签发端点

$ git show HEAD --stat
 .../src/api-key/api-key.controller.spec.ts         | 73 ++++++++++++++++++++++
 .../user-service/src/api-key/api-key.controller.ts | 27 +++++++-
 .../user-service/src/api-key/api-key.service.ts    | 16 ++++-
 3 files changed, 112 insertions(+), 4 deletions(-)
```

改动全在 `servers/user-service/src/api-key/`：

1. `api-key.controller.ts:83-100` —— 新增 `@Post('admin')` + `@UseGuards(AuthGuard)` 端点 `adminCreate`，先 `requireAdminRole`，再取 `email = dto.email ?? req.user.email`（缺失抛 400）、`ownerId = dto.ownerId ?? req.user.id ?? null`，响应 `{ key, prefix, ownerId, message }`。
2. `api-key.service.ts:183-190` —— `adminCreate(email, name?, ownerId?)`，透传 `createKey(email, name, ownerId ?? null, 'admin')`（原为硬编码 `null`）。
3. `api-key.controller.spec.ts` —— 新增 5 条用例。

---

## 2. 逐条判据结论

### 2.1 C1 新增对外接口 —— 登记义务落点（⚠️ 重要 #1）

**判据**：`docs/api/contracts.md` §2「新增 / 改接口 → 先落 `specs/<svc>/api-design.md`（或改注解后重生成），再谈实现」；§7 第 2 条「先文档后实现」。

**证据 A —— `contracts.md` 不逐条列举端点（不需要改它）**：

```
$ sed -n '47,71p' docs/api/contracts.md
## 2. C1 对外 HTTP 接口
**真相源**：各服务的 controller 装饰器（@Get/@Post/@Put/@Delete + Swagger 注解）。
**派生文档**：specs/<svc>/api-design.md，由 scripts/gen-api-design.mjs 从注解自动提取
现有 16 份：ai-agent · ai-service · auth-service · ... · user-service
```

**证据 B —— `specs/user-service/api-design.md` 是 git 跟踪的端点级清单，且粒度含内部端点**：

```
$ git ls-files --error-unmatch specs/user-service/api-design.md
specs/user-service/api-design.md            # 已跟踪

$ grep -n "keys" specs/user-service/api-design.md
18:## ApiKeyController（ApiKeyController → 注册路径基 keys）
20:### POST /api/keys/apply
24:### POST /api/keys/verify
28:### GET /api/keys/mine
31:### DELETE /api/keys/mine/:id
35:### GET /api/keys/
38:### DELETE /api/keys/:id
43:## InternalKeyController（InternalKeyController → 注册路径基 internal/keys）
45:### POST /api/internal/keys/verify
```

→ 清单里**没有** `POST /api/keys/admin`。新端点既未加 `@ApiOperation`，也未重生成派生文档。

**证据 C —— 重生成脚本存在，且不需要 Swagger 注解也能提取**（既有 6 个端点同样无 `@ApiOperation`，仍被列出）：

```
$ ls scripts/gen-api-design.mjs
-rw-r--r--@ 1 geekwen staff 17169 scripts/gen-api-design.mjs

$ grep -rn "gen-api-design\|api-design" .github/workflows/*.yml
（无输出）
```

→ **CI 不校验 api-design 漂移**。这意味着该遗漏不会被任何门禁拦住，只能靠人发现（`contracts.md` §2 的"先文档后实现"在此是纯人工纪律）。

**反例**：下游（含工程 AI 自进化链路，该文件自述为"接口真相源"）查 `specs/user-service/api-design.md` 判断 user-service 有哪些端点 → 实际存在 `POST /api/keys/admin`，文档无 → **消费方静默认为该端点不存在**（不报错、不告警，只是"功能看不见"）。

**严重级**：重要（非阻塞）。理由：无代码消费方会因该遗漏直接失效（派生文档不被 import，运行时 Swagger 仍由 controller 注解实时生成），且一条命令即可补齐。

**放行条件**：合入前跑 `node scripts/gen-api-design.mjs`，将 `specs/user-service/api-design.md` 的增量随 PR 提交；或显式写 `Micro-exempt: <理由>`。

---

### 2.2 C1 —— 越权风险：`requireAdminRole` 与 `req.user.roles`（✅ 通过）

**判据**：`contracts.md` §7 第 1 条（先判影响面）+ 安全面不属于 C1–C6 明列条款 → 按 skill 规则，指不到判据编号的部分降级为"建议"；但本条属评审委托的必答项，按事实给结论。

**证据 A —— `requireAdminRole` 两种形态都正确处理**（`api-key.controller.ts:52-61`）：

```ts
private requireAdminRole(user: any): void {
  const roles: string[] = Array.isArray(user?.roles)
    ? user.roles                                        // 数组
    : typeof user?.roles === 'string'
      ? user.roles.split(',').map((r: string) => r.trim())  // 逗号字符串
      : [];                                             // 其它 → 空
  if (!roles.includes('admin')) {
    throw new UnauthorizedException('需要管理员角色');
  }
}
```

- 数组：`['admin','ops']` → `includes('admin')` ✅
- 逗号字符串：`'admin,ops'` → `split(',')` + `trim()` → `['admin','ops']` ✅
- `undefined` / 非字符串非数组 → `[]` → 抛错 ✅（**fail-closed**，不是 fail-open）
- 关键：`throw` 发生在**任何 service 调用之前**（`controller.ts:89` 先于 `:93`），不会先签发再鉴权。

**证据 B —— `AuthGuard` 挂的确实是 `result.data`**（`servers/user-service/src/auth/auth.guard.ts:42-44`）：

```ts
const result = await response.json();
request['user'] = result.data;
```

而 auth-service `GET /auth/verify` 返回 `{ code: 200, data: user }`（`servers/auth-service/src/auth/auth.controller.ts:85`），对齐 ✅。

**证据 C —— `verifyToken` 返回的 user 确实带 `roles`**（`servers/auth-service/src/auth/auth.service.ts:238`）：

```ts
roles: user.roles || ['user'],
```

共享实体中 `roles` 为 json 列、类型 `string[]`（`packages/shared/src/entities/user.entity.ts:105-107`），即运行时主流形态是数组；逗号字符串分支属防御性兜底，**测试已覆盖**（spec 第 2 条用例）。

**结论**：非 admin 无法调用该端点。注意该实现与本 controller 既有 `list`/`revoke`（`:66`、`:73`）完全同源，未引入新的鉴权路径。

---

### 2.3 C1 —— 是否绕过软删除 / 给已禁用用户签发（✅ 通过）

**证据 A —— `verifyToken` 校验 `status === 'active'`**（`servers/auth-service/src/auth/auth.service.ts:224-228`）：

```ts
const user = await this.userService.findById(payload.sub);
if (!user || user.status !== 'active') {
  throw new UnauthorizedException('用户不存在或已被禁用');
}
```

→ `inactive` / `banned`（`packages/shared/src/entities/user.entity.ts:80` 定义 `status: 'active' | 'inactive' | 'banned'`）一律 401，拿不到能过 `AuthGuard` 的 token。

**证据 B —— 软删除前提在该实体上不成立**：

```
$ grep -n "deletedAt\|DeleteDateColumn" packages/shared/src/entities/user.entity.ts
（无输出）
```

→ 共享 `User` 实体**没有** `@DeleteDateColumn` / `deletedAt`。故"绕过 deletedAt 软删除用户"这一风险在本改动上**不适用**（无软删除机制可绕）；若用户被物理删除，`findById` 返回 `null` → 被 `!user` 分支挡住。

**证据 C —— 登出令牌也被挡**：`verifyToken` 先查 Redis 黑名单（`auth.service.ts:219-221`）。

**结论**：无法通过已禁用 / 已登出 / 不存在用户的 token 签发 key。

---

### 2.4 `adminCreate` 签名变更是否破坏性（✅ 通过）

**判据**：`contracts.md` §7 第 5 条「破坏性变更写消费方清单」——先确认是否**存在**消费方。

**证据 A —— 改动前零调用方（确为死代码）**：

```
$ git show HEAD~1:servers/user-service/src/api-key/api-key.controller.ts | grep -c "adminCreate"
0

$ git show HEAD~1:servers/user-service/src/api-key/api-key.service.ts | grep -n "adminCreate" -A 3
177:  async adminCreate(email: string, name?: string): Promise<{ plaintext: string; prefix: string }> {
178-    return this.createKey(email, name, null, 'admin');
179-  }
```

**证据 B —— 当前全仓 `adminCreate` 出现点**（Grep 全仓，排除 node_modules）：

```
servers/user-service/src/api-key/api-key.controller.ts:85   （新增端点定义）
servers/user-service/src/api-key/api-key.controller.ts:93   （唯一调用点，本次新增）
servers/user-service/src/api-key/api-key.service.ts:183     （定义）
servers/user-service/src/api-key/api-key.controller.spec.ts:* （测试）
```

→ 除本次新增的端点外无任何调用方，也无其它服务通过 HTTP 调用（改动前不存在对应端点）。

**结论**：新增**可选**第 3 参，且唯一调用方是本次新增代码 → 非破坏性变更，**无需消费方清单**。commit message 的 `Contract:` 自述与此一致。

---

### 2.5 敏感信息：明文 key 单次返回（✅ 通过）

**证据 A —— 与既有端点同约定**（`api-key.controller.ts:32-36`，`POST /api/keys/verify` 是公开端点）：

```ts
const { plaintext, prefix } = await this.svc.verifyAndIssue(dto);
return { key: plaintext, prefix, message: 'API Key 已生成，请妥善保管（明文仅展示一次）' };
```

新端点（`:94-99`）返回 `{ key: plaintext, prefix, ownerId, message }` —— **同一形态**，仅多一个 `ownerId`。服务端只存 `keyHash`（`api-key.service.ts:38`），明文仅响应中出现一次，符合既有约定。

**证据 B —— 新增代码无日志输出**：

```
$ grep -rn "Interceptor\|Logger\|console.log" servers/user-service/src/api-key/api-key.controller.ts
（无输出）
```

→ controller 层无 Logger、无 console。service 层有 `Logger(ApiKeyService.name)`（`api-key.service.ts:17`），但本次未在任何路径加日志；`createKey` 只落 `keyHash`/`keyPrefix`（`:44-46`）。

**证据 C —— 统一响应包装不改变明文暴露面**：`TransformInterceptor`（`common/interceptors/transform.interceptor.ts:32-36`）把返回值包成 `{ code: 0, data: {...}, message: 'success' }`，明文仍在 `data` 内一次，与 `verify` 一致。

**结论**：符合既有约定，无新增泄露面。建议（无判据，个人偏好）：保持"不打日志"约束写进代码注释，避免后续维护者在 service 里加 `logger.log(plaintext)`。

---

### 2.6 审计语义：ownerId 必须绑到人 —— 判据成立（⚠️ 重要 #2）

**证据 A —— deploy-console 确以 ownerId 为操作人**（`servers/deploy-console/src/mcp/mcp-key.guard.ts:32-38`）：

```ts
const result = await this.mcpAuth.verifyKey(key);
if (!result.valid || !result.ownerId) {
  throw new UnauthorizedException('invalid or revoked MCP key');
}
req.mcpOperator = result.ownerId;
req.mcpKeyId = result.keyId;
```

文件头注释（`:15`）明确："ownerId 缺失时一律拒绝 —— 审计不允许出现 mcp/anonymous/unknown"。

**证据 B —— 校验链路**（`servers/deploy-console/src/mcp/mcp-auth.service.ts:10-15, 38-46`）：调 user-service 内部接口 `/internal/keys/verify` 取 `ownerId` 作为操作人。

**→ 判据成立**：`ownerId = null` 的 key 在 MCP 通道直接被拒（fail-closed），即使放行也追溯不到人。故"ownerId 必须绑到人"是真实约束，不是自辩。

**证据 C —— 但本次实现未校验 ownerId 指向的"人"是否真实存在/有效**：

- `controller.ts:92`：`const ownerId = dto?.ownerId ?? req.user?.id ?? null;` —— `dto.ownerId` **完全信任**，不查用户表。
- `api-key.service.ts:30-52` `createKey`：`ownerId: ownerId ?? null` 直接落库，**无外键校验、无存在性校验、无 active 校验**。
- 全局 `ValidationPipe`（`main.ts:31-35`）带 `whitelist/forbidNonWhitelisted`，但新端点 DTO 是**内联对象类型**（`controller.ts:87`），metatype 为 `Object`，Nest 的 ValidationPipe 对非 class 不做校验 → `ownerId` 连类型都不校验。

**反例**：admin 传 `ownerId: 999999`（不存在）/ 或指向一个 `status='banned'` 的用户 → 签发成功、响应 200，McpKeyGuard 只检查 truthy 因此放行 → 审计日志里 `mcpOperator = 999999`，**追溯到一个不存在的/已禁用的人**，与本次改动自称的目的（"审计可追溯人"）相悖。

**严重级**：重要（非阻塞）。理由：① 该形态与既有公开端点 `POST /api/keys/verify`（`ownerId` 同样来自 body、同样不校验，`api-key.service.ts:135`）**同构**，属既有面而非本次引入的破坏性变更；② 触发前提是 admin 主动传错值，非外部可越权利用；③ fail-closed 侧（ownerId 为空）已被 guard 挡住，不会出现"匿名凭据"。

**放行条件**：要么在 controller/service 侧校验 `ownerId` 对应用户存在且 `status === 'active'`；要么在 PR 说明中明确"显式 ownerId 由 admin 负责正确性"并留 TODO。**建议合入前补校验**（成本极低，直接把"绑到人"从事后约定变成机器保证）。

---

### 2.7 C3 MCP 工具（✅ 未触及）

**判据**：`contracts.md` §4（真相源 `servers/mcp-gateway/src/mcp/mcp.service.ts`）。

**证据**：`git show HEAD --stat` 的 3 个文件全部位于 `servers/user-service/src/api-key/`，未触及 `servers/mcp-gateway/src/*/tools/*`（skill 定义的 C3 触发面）。MCP 工具声明（`name`/`description`/`params`）零改动，无需同步 DB 能力绑定或 agent 提示词（`contracts.md` §4 变更纪律）。

→ 预期"否"已验证。

### 2.8 C4 权限码 / 共享常量（✅ 未触及）

新端点走**角色判断**（`roles.includes('admin')`），未新增权限码，`packages/types/src/index.ts` 未改动（`--stat` 佐证）→ 无需走 §5 的双构建与权限点同步纪律。

### 2.9 C5 网关路由（✅ 无需改动）

**判据**：`contracts.md` §6 —— 精确 + 通配成对注册，认证由后端服务负责。

```
$ grep -n "keys" servers/gateway/src/proxy/proxy.controller.ts
67:  @All('keys')
73:  @All('keys/:path(*)')
```

→ 精确 + 通配**成对**存在，`POST /api/keys/admin` 落在 `keys/:path(*)` 通配上，无需新增特化路由；也不存在"被通配抢走"的问题（本端点本就该走通配）。认证由 user-service 的 `AuthGuard` 承担，与 §6「Gateway 只做代理转发，不做鉴权」一致。

---

### 2.10 测试独立复跑（✅ 通过）

```
$ cd servers/user-service && npx jest src/api-key/api-key.controller.spec.ts
PASS src/api-key/api-key.controller.spec.ts
  ApiKeyController.adminCreate
    ✓ 非 admin 角色 → 拒绝（403/401），不签发
    ✓ roles 为逗号字符串时也能识别 admin
    ✓ 未显式传 ownerId → 绑定到操作者本人（可追溯）
    ✓ 显式传 ownerId → 以显式值为准
    ✓ 既无 dto.email 也无 user.email → 拒绝（不产出无主 key）
Tests: 5 passed, 5 total
```

→ 5 条用例独立复跑全绿，非采信变更方自述。

---

## 3. 越权面核查（汇总）

| 攻击面 | 结论 | 证据 |
|---|---|---|
| 无 token | 拒（401） | `auth.guard.ts:29-31` |
| token 无效/过期/已登出 | 拒（401） | `auth.guard.ts:38-40` + `auth.service.ts:219-221`（黑名单）、`:245` |
| 已禁用 / banned 用户 | 拒（401） | `auth.service.ts:226-228` |
| 物理删除用户 | 拒（401） | `auth.service.ts:226`（`!user`）；共享实体无软删除列 |
| 非 admin（roles 为数组） | 拒（401） | `controller.ts:53-58` |
| 非 admin（roles 为逗号字符串） | 拒后放行仅当含 admin | `controller.ts:55-56` + spec 用例 2 |
| roles 缺失 / 类型异常 | 拒（fail-closed） | `controller.ts:57` → `[]` → 抛错 |
| 绕过邮件验证码 | **设计如此**（该端点定位即"免邮件验证码的 admin 直签"） | `controller.ts:78-82` 注释 |
| 鉴权顺序 | 先鉴权后签发 | `controller.ts:89` 先于 `:93`；spec 用例 1 断言 `not.toHaveBeenCalled()` |

**唯一被放宽的口子**：`dto.ownerId` 可任意指定且不校验（见 §2.6，重要 #2）。属审计完整性问题，**非越权**（调用者本身已是 admin）。

---

## 4. 阻塞项与放行条件

### 阻塞项：无（`阻塞: 0`）

无一项会导致既有消费方**静默失效**或构成破坏性变更。

### 重要项（2）

| # | 项 | 判据 | 放行条件 |
|---|---|---|---|
| 1 | `specs/user-service/api-design.md` 未随新增对外端点重生成，C1 派生清单漂移；且 CI 无该漂移的机检 | `contracts.md` §2 变更纪律第 1 条 · §7 第 2 条 | 跑 `node scripts/gen-api-design.mjs`，增量随 PR 提交；或写 `Micro-exempt: <理由>` |
| 2 | `dto.ownerId` 任意指定且不校验存在性/active，可把 key 绑到不存在或已禁用的人，审计"绑到人"语义可被绕过 | `contracts.md` §7 第 1 条；事实判据 `mcp-key.guard.ts:33` 仅校验 truthy | 补 owner 存在性 + active 校验（推荐）；或在 PR 说明里显式承担并留 TODO |

### 建议区（无判据编号，属个人偏好，可驳回）

1. **`ownerId: 0` 会产出"签发成功但不可用"的 key** —— `controller.ts:92` 的 `??` 只挡 null/undefined，`0` 会穿透并落库，而 `mcp-key.guard.ts:33` 的 `!result.ownerId` 会拒用（fail-closed，安全侧无害，但体验上是"发了个废 key"）。建议加 `> 0` 校验。
2. **401 vs 403 语义** —— `requireAdminRole` 抛 `UnauthorizedException`（401），语义上"已认证但无权限"应为 403。与既有 `list`/`revoke` 同源，**非本次引入**；若要改需三个端点一起改，建议单开改动。
3. **内联 DTO 不受 ValidationPipe 保护** —— `@Body() dto: { email?: string; ownerId?: number; name?: string }` 是类型字面量，运行时不做校验也不做 whitelist 剥离。既有 `apply`/`verify` 同为内联类型，属既有风格；若要收紧建议改 class + `@ApiProperty`（顺带让 api-design 生成出字段级 schema）。
4. **`ownerId` 类型不一致** —— controller 侧 `number`，`McpAuthService.McpKeyVerifyResult.ownerId` 声明为 `string`（`mcp-auth.service.ts:6`）。既有不一致，不影响运行（guard 只判 truthy），但会误导后来者。
5. **spec 用例 1 标题写"（403/401）"** —— 实际断言 `UnauthorizedException`（401）。标题与断言不符，建议收敛为 401。

---

## 5. 未覆盖项与评审局限

### 未验证（明确标注）

1. **未做运行时/端到端验证** —— 未启动服务、未连数据库、未实际以 admin token 打 `POST /api/keys/admin`。所有结论基于静态代码 + 单测。
2. **`roles` 运行时真实形态未实测** —— 静态证据是 json 列 `string[]`（`packages/shared/src/entities/user.entity.ts:105-107`），但库中是否存在历史遗留的逗号字符串数据未查。代码两分支均已覆盖，风险已闭环。
3. **PR #255 的 CI 结果未查** —— 未跑 `gh pr checks`，未确认 R13/R16 是否报 warning。
4. **`api-design.md` 在其它服务是否同样漂移未查** —— 超出本次改动面，若普遍漂移属存量问题，建议单开。
5. **`tsc --noEmit` 未独立复跑** —— commit 自述 EXIT=0，本次仅独立复跑了 jest；类型面对 `adminCreate` 加可选参风险极低（无外部调用方）。
6. **gateway 透传未实测** —— 仅静态确认 `keys/:path(*)` 存在，未验证实际转发与 CORS（`main.ts:39-44` 的 `CORS_ORIGINS` 配置）对该路径的行为。

### 评审局限（诚实标注）

- **独立性弱于跨人评审**：本次评审者与改动处在**同一个会话**（分支由同一会话产出并推送为 PR #255）。已通过"先读判据源形成应然、再看改动"（skill 盲审第 1 步）与"独立复跑测试而非采信自述"来尽量逼近独立第三方，但**无法排除同源视角盲区**（例如对 commit message 里"死代码""审计可追溯"等论断的接受度可能偏高）。
- 对上述自述论断，本报告已用 grep/git show 逐条落到代码证据（§2.4、§2.6），未采信任何无证据的说法。
- 建议：若该改动要进生产，补一次跨人（或跨会话）的交叉复核，重点看 §4 重要 #2 的 owner 校验是否补、以及 §5 未验证 #1 的端到端行为。

---

## 附：复跑命令

```bash
# 改动面
git show HEAD --stat
git show HEAD~1:servers/user-service/src/api-key/api-key.controller.ts | grep -c adminCreate   # 0 = 死代码

# C1 派生清单是否含新端点
grep -n "keys/admin" specs/user-service/api-design.md                                           # 应无输出 = 漂移
node scripts/gen-api-design.mjs                                                                 # 修复动作

# C5 网关路由
grep -nE "@All\('" servers/gateway/src/proxy/proxy.controller.ts | grep keys

# 审计判据
sed -n '30,40p' servers/deploy-console/src/mcp/mcp-key.guard.ts

# 测试
cd servers/user-service && npx jest src/api-key/api-key.controller.spec.ts
```
