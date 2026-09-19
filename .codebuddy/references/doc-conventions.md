# 文档约定（Doc Conventions）

> 项目级文档写法约定。默认开关按**高速变更期**调好。
> **应用侧 = 读/写这些文档的 Agent**（不是 deploy-console 的「应用」实体，也不是最终用户）；Agent 按文档顶部开关行执行，可自行改开关值。
> 触发规则：`.codebuddy/rules/doc-conventions/RULE.mdc`。

## 1 开关

每份文档在开头声明当前开关，应用侧直接改这一行即可：

```
> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
```

| 开关 | 默认 | 含义 | 设为 `on` 时的写法 |
|---|---|---|---|
| `CHANGELOG` | `off` | 是否在文末追加「变更日志」表 | 每次修订追加一行（日期 + 变更摘要） |
| `HISTORY_NOTE` | `off` | 是否写历史沿革（「已修复 / 已澄清 / 之前是 X 现在是 Y」） | 允许解释性叙述与 `~~删除线~~` 旧条目 |
| `FAQ_KEEP` | `on` | 是否保留「常见问题」段落（含「（已修复）」标注） | 保留并持续追加；设 `off` 时把 FAQ 沉淀到「最佳实践」文档 |

## 2 约定正文

1. **只写当前事实**：内容过时直接改掉对应条目，不留痕迹（`HISTORY_NOTE=off` 时）。
2. **事实源在代码层**：端口 / 路由 / 服务清单以代码为真相源（本机 `ecosystem.config.cjs`、服务器 `ecosystem.config.js`、`servers/gateway/src/proxy/proxy.controller.ts`），文档只做索引与流程说明。
3. **文档之间不复制正文**：专题细节留在专题文档，总索引只做导航，避免同一事实散落多处。
4. **FAQ 暂保留**，后续视情况整体迁到「最佳实践」类文档（开关 `FAQ_KEEP` 控制）。

## 3 相关

- 本地开发总索引：`docs/development/local-dev-guide.md`
- 工程文档入口：仓库根 `README.md` → `docs/development-guide.md`
