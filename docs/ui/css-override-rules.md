# 科豆 AI · CSS 覆盖与颜色优先级规则（Override Rules）

> 版本：v0.1（草案，待批注）｜ 日期：2026-09-03
> 定位：**"颜色改了不生效 / 两处覆盖冲突 / 谁赢说不清"的权威规则**。
> 何时读：① AI 要覆盖 antd 组件外观前；② 改色后发现页面没变；③ 新 app 接入 @web-system/ui 前。
> 配套：《color-reference.md》（颜色定义点地图，管"在哪定义色"）；本文档管"多层之间谁生效"。

---

## 1. 覆盖优先级总览（由底层到顶层）

```
tokens.ts（数值唯一源）
  └─► tokens.css :root（light）/ [data-theme='dark']（CSS 变量，唯一定义处）
       └─► antd ThemeConfig（antd-theme.ts，cssinjs 运行时生成组件默认样式）
            └─► theme.css（全局兜底，!important = 0，新条目须注释理由）
                 └─► 业务全局 css（app style.scss，已收敛，新代码禁裸色/禁 !important）
                      └─► 组件 <style scoped> :deep(.ant-xxx)（页面特例，引用 --ws-*）
                           └─► 内联 style / !important（禁止）
```

**胜出规则**：同一选择器目标上，越靠后 + 特异性越高者生效。因此：
- **改值 → 改 token**（tokens.ts）；**改 antd 组件默认 → 改 antd-theme.ts 组件 token**；**全站兜底 → theme.css**；**单页特例 → scoped `:deep`**。
- **内联 / !important / 页面级 `.ant-xxx` 裸类**：一律禁止，存量清零。

## 2. 覆盖"四问"（动手覆盖任何 antd 外观前必答）

1. **这个外观 antd 有没有对应组件 token？**（`antd-theme.ts` components 里查；类型以 ant-design-vue 4.x 为准）有 → 进 theme 配置，别写 CSS。
2. **是不是只有这一页要这样？** 不是（多页共患）→ 提升为 theme token / theme.css 公共工具类；是 → 才允许 scoped `:deep`。
3. **这个色有没有 Token？** 没有 → 先补 tokens.ts + tokens.css（双文件同步），再引用；有 → 直接用 `--ws-*`，禁裸 hex。
4. **dark 下也要一样吗？** 不确定 → 默认两主题都要过目；写进 `:global([data-theme='dark'])` 的必须注释原因（参考 ServiceManager `.svc-builtin`）。

**排查"改了不生效"固定顺序**：
① grep 是否还有第二处同目标覆盖（含 antd token、theme.css、app 全局 css）→ ② 看是不是变量没定义/被 app 二次定义（§3）→ ③ 看选择器特异性（scoped `:deep` > 类 > 元素；同特异后加载赢）→ ④ 看是不是 antd cssinjs 动态注入晚于你的静态 css（此时只能靠 ThemeConfig token 或 :deep 提特异）→ ⑤ 看是不是 dark 块漏变量回退 light（diff :root 与 [data-theme=dark] key 集合）。

## 3. 同一变量只许一处定义（防双份漂移）

- `--ws-*` 变量**只允许出现在 `packages/ui/src/tokens.css`**；任何 app / 组件不得再定义同名变量。
- antd 组件 token 只从 `uiTokens` 映射（antd-theme.ts），业务代码不改。
- **历史债**：admin 未接 `@web-system/ui`，其 `src/style.css` 自含 `:root`/`[data-theme='light']` 变量定义。灰度接入时**必须删除自身变量块**，改引 tokens.css；在接入前，admin 的覆盖不受本规则约束但视为"过渡期例外"。
- 真的需要 app 局部主题变量 → 命名空间前缀 `--app-*`，并注释"app 局部，不进公共 token"。

## 4. 固定面板例外边界（不随 data-theme 的色）

侧栏 / 日志终端 / 登录页等"固定色"是**例外不是特权**，遵守：

1. 集中在带"例外"注释的段落（现有：deploy-console style.scss 登录/日志/侧栏已注释，✅）。
2. **禁 !important**：✅ 全仓库已清零（R4，2026-09-03）。外壳固定色走两条路径：Header → App.vue `Layout.colorBgHeader`（app 侧扩展，共享 antdTheme 保持中性）；Sider → MainLayout.vue scoped `:deep` 提特异 (0,3,0)（**ant-design-vue 4.2.6 实测无 `siderBg` token**，css 层只能高特异，`!important` 不属可选项）。
3. 固定色值本身也应升具名 token（--panel-bg / --panel-item-hover / --panel-item-selected，见 color-reference.md §4），业务引用变量而非裸值，便于统一维护与 dark 一致性判断。
4. 例外会"污染"的判断标准：**新组件放进去会不会被固定色误伤** → 例外必须限定在专属类（.app-sider / .log-panel / .login-*），不许用元素选择器。

## 5. 加载顺序约定（每个 app main.ts 固定）

```ts
// 顺序不可调换：ui 变量/兜底先，业务全局后（业务靠后加载赢 = 允许，但业务不许写 reset/font 重复声明）
import '@web-system/ui/tokens.css'
import '@web-system/ui/theme.css'
import '<app>/style.scss'   // 业务全局：只写业务类，不重复 reset/font-family（R1 规则 3）
```

- 业务全局 css **禁止重复** `*{margin}` reset、`font-family`、`background: var(--ws-bg-page)` 等（theme.css 已统一）。
- antd reset.css 由 `setupAntd` 统一引入一次，app 不再引。
- cssinjs 动态注入晚于静态 CSS → **同特异性下 antd 运行时样式可能盖过静态覆盖**；结论：改 antd 默认不靠"后加载"，靠 ThemeConfig token 或 `:deep` 提特异。

## 6. 自查命令

```bash
# 残留 !important（✅ 2026-09-03 R4 已清零，目标保持 = 0）
grep -rn '!important' apps/*/src packages/ui/src

# 变量二次定义（--ws-* 只许出现在 tokens.css）
grep -rn -- '--ws-' apps/*/src | grep -v tokens.css   # 应为空

# 页面级裸 .ant- 全局覆盖（应进 theme.css / antdTheme，不散页面）
grep -rn '\.ant-' apps/*/src --include='*.vue' | grep -v ':deep' | grep -v '.ant-table' | head

# :global 特例（应有注释）
grep -rn ':global' apps/*/src --include='*.vue'
```

## 7. 现状问题登记（2026-09-03 扫描）

| # | 问题 | 位置 | 状态 |
|---|---|---|---|
| 1 | `.app-sider`/`.app-header`/`.logo-text` 共 4 处 `!important` | deploy-console `style.scss` | ✅ 已整改（R4）：Header→App.vue `Layout.colorBgHeader`；Sider→MainLayout scoped `:deep`；散写色升 `--dc-panel-*`（app 局部变量） |
| 2 | admin 自含整套 `:root`/`[data-theme]` 变量（未接 tokens.css） | admin `src/style.css` + `lifecycle.ts` | 过渡期例外；灰度接入时删自身变量 |
| 3 | `:global([data-theme='dark'])` 特例无注释规范 | ServiceManager `.svc-builtin` | 已有实例；规则 §2-4 生效后新代码须注释 |
| 4 | App.vue data-theme 监听 + antdTheme(mode) 已接（deploy-console） | deploy-console `App.vue` | ✅ 良好样板，admin 接入时照抄 |
| 5 | antd-theme `SIDER_BG` #171717 与 style.scss 实际 #0F0F12 不一致（文档/代码漂移） | `packages/ui/src/antd-theme.ts` | ✅ R4 统一为 #0F0F12 |

---

*v0.1.1（2026-09-03 R4）：!important 清零、`--dc-panel-*` 方案登记。待批注后挂进 rd-execute「UI 前置加载」清单。*
