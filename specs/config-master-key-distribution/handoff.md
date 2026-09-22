# CONFIG_MASTER_KEY 多机分发 · 新会话交接

> 开关：CHANGELOG=off · HISTORY_NOTE=off · FAQ_KEEP=on
> 定位：`specs/service-config-delivery/design.md` 分期里的 **P2**（独立小设计）——主密钥怎么到各台机器、怎么轮换。**先出设计、评审后再动代码。**

分支基线：`feature/deploy-console-domain-split` ｜ 交接时间：2026-09-22

---

## 1. 要解决什么

主密钥 `CONFIG_MASTER_KEY` 是**配置中心所有密钥（`is_secret=1`）的解密钥匙**（AES-256-GCM，见 `config-crypto.ts`）：

- 它**不能**放进配置中心（鸡生蛋：读配置中心本身要先有它）；
- 它必须**在多台机器上完全一致** —— 那些机器共享同一个 `web_system_deploy` 库的 `config_items`，
  密钥不一致 = GCM 认证失败（解密直接抛错，不是"解出乱码"）；
- 现在它只出现在 `servers/deploy-console/.env` 里（人工维护、逐台复制），**没有任何一致性校验与轮换方案**。

P2 要产出的，就是上面这两件事的方案：**分发（到哪、怎么送、怎么证明对）** + **轮换（怎么换而不丢数据）**。

## 2. 现状事实（开工前不必重新考古）

| 项 | 值 |
|---|---|
| 读取位置 | `servers/deploy-console/src/config/config-crypto.ts` → `masterKey()`，只读 `process.env.CONFIG_MASTER_KEY` |
| 支持的形态 | base64（44 字符）/ 64 位 hex / 任意字符串（scrypt 派生 32 字节）；非法长度直接抛错 |
| 谁在用 | 目前**只有 deploy-console**：它是唯一读写 `config_items` 的服务（其他服务靠「下发 `.env.generated`」拿到明文，不需要主密钥） |
| 存储位置 | `servers/deploy-console/.env`（`env=local` 与堡垒机部署目录各一份，**人工维护**） |
| 消费的数据 | `config_items.value` 里 `is_secret=1` 的行（密文形如 `iv:authTag:ciphertext`，base64） |
| 现状边界 | `service-config-delivery/design.md` §6 明确写了：多机分发**不在该设计范围**，建议「由部署机密钥文件/环境注入，不要塞进配置中心」 |
| 相关坑 | `CONFIG_MASTER_KEY` 缺失/不对时，**报错发生在"读密钥那一刻"**（解密时），不是启动时 → 换机器漏配会静默到"某次读配置才炸" |

## 3. 待确认项（新会话里逐条问清再定稿）

| # | 问题 | 影响 |
|---|---|---|
| Q1 | 现在到底有几台机器需要它？（本地 / 堡垒机 / dev / prod…）各自的值是否已一致？ | 决定"分发"要覆盖的面与自检范围 |
| Q2 | 交付通道选哪种：部署机密钥文件（0600，root）／pm2-systemd 环境注入／云 KMS-Secrets Manager／人工 `.env` + checklist | 决定实现量级与安全边界 |
| Q3 | 是否需要**在线轮换**（不中断）？ | 决定要不要给 `config_items` 加 `key_id`（见 §4） |
| Q4 | 轮换的操作者与审批？是否要留审计？ | 决定是否需要控制台命令 / 脚本 + 审计 |
| Q5 | 应急：主密钥泄露时的处置流程（先止血再轮换？） | 决定流程章节内容 |
| Q6 | 新机器上线流程（谁送、怎么验证、失败如何回退） | 决定 checklist 与自检命令 |

## 4. 候选方案（供设计时取舍，不必先定）

**分发**
- **A 密钥文件 + 权限收口**：`/etc/web-system/config-master.key`（0600，root:root），`servers/deploy-console/.env` 只留 `CONFIG_MASTER_KEY_FILE=` 指向它。
  - 优点：不进 git、不进镜像层、不进进程列表；`chmod` 即权限边界；变更可审计（文件系统）。
  - 代价：`config-crypto.ts` 要支持"从文件读"（十几行）。
- **B 部署时注入环境**：部署脚本/systemd `EnvironmentFile` 读密钥文件再注入 pm2 env。
  - 优点：不动代码。缺点：与项目既有铁律冲突（进程环境刻意只保留 `PATH/HOME/PORT`），易被 `--update-env` 污染。
- **C 云 KMS / Secrets Manager**：走 SDK 拉取。
  - 优点：轮换/审计最规范；缺点：引入 SDK + 云权限 + 调用链依赖，本地开发还要有回退路径。
- **D 维持人工 `.env` + 补「一致性自检 + 上线 checklist」**（最小改动）。
  - 值得单独做的一点：**启动自检** —— 解一条已知的 `is_secret` 行，解不开就 fail-fast 并明确报「主密钥与本库不匹配」，
    把"某次读配置才炸"变成"启动即报"。

**轮换**（AES-GCM 密文不能就地换密钥）
- **E 停机式**：窗口内「解密全部 `is_secret` → 用新密钥重新加密 → 重启各 console」。
- **F 版本化密钥**：给 `config_items` 加 `key_id`（或密文前缀带 keyId），支持"双密钥并行解密"，
  重加密完成后下线旧密钥。可分步、无需停机，但要多一次 schema 变更 + 读写分支。
- 无论 E/F，都要先想清：**哪些密文副本存在**（`config_items.value` + `config_snapshots.payload` 里也有密文！回滚快照同样要重加密）。

## 5. 验收判据（建议口径，设计时再细化）

| # | 判据 |
|---|---|
| K1 | 按文档在一台**新机器**上一次到位：console 启动即自检通过（能解密 `is_secret` 项），无需人工试错 |
| K2 | 主密钥不出现在：git 仓库、命令历史、进程命令行、应用日志、镜像层 |
| K3 | 主密钥不一致时**启动即失败**并给出可执行的修复提示（不再静默到"读配置才炸"） |
| K4 | 轮换后：全部 `is_secret` 项（含 `config_snapshots.payload`）仍可解密；旧密钥失效后无法解密 |
| K5 | 回退可走：任一步失败都能回到轮换前状态（保留旧密钥副本 + 备份表/快照） |

## 6. 新会话怎么开工（把这段整段贴给新会话）

```
读 @specs/config-master-key-distribution/handoff.md 与 @specs/service-config-delivery/design.md（§6 安全与回退、§7 P2），
把「CONFIG_MASTER_KEY 多机分发 + 轮换」这个独立小设计做出来。

要求：
1. 先按项目约定出设计文档 specs/config-master-key-distribution/design.md（现状事实 / 候选方案对比 / 推荐 / 数据与流程 /
   待确认项 Q1-Q6 / 验收判据 / 分期），走 tech-review 评审；
2. 我确认后再实现；实现分批、每批可独立回退，动代码前先更新 handoff.md 里的现状事实；
3. 范围边界：只解决"主密钥怎么到机器、怎么证明一致、怎么轮换"；
   不改配置中心本身的数据模型（除非 Q3 选了版本化密钥 F，那要先单独确认）；
4. 验证：本地 + 堡垒机各跑一遍 K1-K3，轮换流程在本地演练。
```

> 为什么单独开一轮：P2 是**凭据分发与轮换**，属安全方案，按 `be-developer` 的技能约定要先走 `tech-review`；
> 它跟 `service-config-delivery` 的 P0/P1（配置下发链路）没有代码耦合，混在一轮里会拖慢两边。

## 7. 不做（边界）

- 不做 `CONFIG_MASTER_KEY` 的「放进配置中心」版本（鸡生蛋，永不做）；
- 不把服务端解密能力下放给业务服务（它们继续靠 `.env.generated` 拿明文，见 `service-config-delivery/design.md` §4.0）；
- 不在本轮改 `config_items` 表结构（除非 Q3 明确选 F，另开批次）。
