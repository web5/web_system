# 部署动作接入发布流程（发布部署 = 两个动作）

> 建立：2026-09-20 ｜ 分支：`feat/deploy-console-domain-split` ｜ **仅 local 验证**
> 配套：`specs/pipeline-env-scripts/design.md`、`docs/development/local-dev-guide.md §3.2`
>
> ⛔ **已废弃（2026-09-20，commit `c5ec6ad`）**：自动部署逻辑已移除。
> 原因：「是应用还是服务」是**运维知识**，不该做成运行时的域归属判断塞进系统
> （先后试过 `moduleType`、`TargetResolver` 两种分流，都不对）。
> 系统只提供部署接口，由流水线脚本 / 控制台显式调用。
> 保留本文仅作决策记录；现行做法见 `docs/development/deploy-target-knowledge.md`。

---

## 1. 背景

用户口径（2026-09-20）：**发布部署是一个整体的两个流程动作** ——

1. **发布**：流水线（拉码 → 构建 → 投递产物 → 写版本记录）
2. **部署**：让产物生效（前端切指针 / 后端「版本目录 → dist + 重启 + 探活」）

现状：流水线只完成第 1 步，第 2 步是断的，实测表现为 `succeeded` 但页面/服务没变：

| 类型 | 断点 |
|---|---|
| 后端 | `apply` / `restart` 守卫 `moduleType !== 'backend'`，而 `p.moduleType` **从未写入**流水线实体 → 永远跳过 |
| 前端 | 流水线只写版本记录，没有切 env-dir 指针 → 页面仍加载旧版本 |

---

## 2. 范围与开关（用户定：local 生效 + 加开关）

| 项 | 取值 |
|---|---|
| 开关 | `PIPELINE_AUTO_DEPLOY=1`（**默认关闭**） |
| 生效范围 | **仅 `env === 'local'`**；dev / prod **行为完全不变**（不改守卫、不自动部署） |

理由：dev/prod 此前部署一直是人工独立动作，贸然改为自动重启会改变发布语义；
先在 local 打通并验证动作正确，再决定是否推广。

---

## 3. 设计

### 3.1 部署动作放在哪

流水线 `succeeded` 之后**自动衔接**（作为整体流程的第二个动作），不新增节点、不改模板：

```
发布（流水线节点跑完 → succeeded）
   ↓ 开关开 且 env=local
部署（按模块类型分流）
   ├─ 后端（backend）  → ServicesService.deploy(key, env)：版本目录 → dist + 重启 + 探活
   └─ 前端（env-dir）  → AppsService.switchVersion(key, env, version)：切入口指针
```

复用已有能力，不新增部署实现（避免两套重启姿势）。

### 3.2 失败语义

部署失败**不改变发布结果**（发布确实成功了），但必须可见：

- 写 `p.result.deploy = { ok:false, error }` 与日志
- 不阻断、不回滚（部署是独立动作，失败可重试）

### 3.3 前置约束（重要）

前端 `switchVersion` 会校验产物存在：`<key>/<envId>/<版本>/index.js`。
因此**发布脚本投递的目录必须与 `deployMode` 的布局一致** ——
按 `specs/pipeline-env-scripts/design.md`，本地脚本投到 `<key>/<envId>/<版本>/`（由脚本自己决定）。

若脚本投的是旧布局 `<key>/<模板key>/<版本>/`，部署会报「版本产物不存在」—— 这是**预期内的报错**，
用于暴露布局不一致，不做静默降级。

---

## 4. 影响面

| 位置 | 改动 |
|---|---|
| `pipeline.service.ts` | 成功后衔接部署（受开关 + env=local 约束） |
| `pipeline.module.ts` | 引入 `AppsModule` / `ServicesModule`（部署能力） |
| 单测 | 开关关闭不部署 / local 才部署 / 后端走 services、前端走 apps / 失败只记录不阻断 |

---

## 5. 回退

`PIPELINE_AUTO_DEPLOY` 不设置（默认）→ 完全无部署衔接，行为与改动前一致。

---

## 6. 验证（本地）

1. 单测
2. 端到端：`admin` 流水线 `env=local` 跑完 → 自动切指针 →
   `curl /__manifest__?site=local` 指向新版本 → 页面硬刷新可见
3. 反向验证：开关关闭时跑同样流水线 → 不切指针（行为不变）
