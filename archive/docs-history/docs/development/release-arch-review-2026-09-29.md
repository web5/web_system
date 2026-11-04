# 发布与部署技术架构 Review（2026-09-29）

> 范围：web_system 全平台（前端三端 shell/portal/admin + 后端 13 服务）发布链路。
> 依据：2026-09-26~29 实测事实（A1 prod 转 git、PR #205/#207/#208/#213/#215/#224/#225、本轮 13 条流水线修复）。

## 一、现状架构（as-is，一句话版）

```
git push → CI quality-gate（红线扫描 + build/test）→ 自动合 master
  → deploy-console 流水线（dev 机 6200，Beehive UI）
      ├─ 拉取代码（平台托管）→ 构建（平台托管）→ 发布确认·审批（gate）
      └─ 发布节点：local / dev / prod 三个任务按 DEPLOY_ENV 条件分流
          ├─ 前端：投产物到版本目录 → byEnv 指针(index.js/index.css) → 写版本表（NEW 域 + legacy 双写）
          ├─ 后端：投 dist 到远端版本目录 → sync 依赖 → pm2 重启 → verify(端口/进程) → write-version
          └─ prod：控制台直连（scp + mysql 直写 web_system 库，无 prod 控制台）
  → gateway 按 deploy_sites(域)/manifest 读指针 → SystemJS 拉模块；CDN 子集(antd/icons)随 deploy.sh cdn
```

**版本真相源现状**（三处并存）：
1. `deploy_app_env_versions`（NEW 域，env-dir 指针，gateway 真正读的）
2. `deploy_deployments.current_version`（legacy，兼后端服务指针 + 前端兜底）
3. 磁盘 byEnv 指针文件（`/static/modules/<k>/<envId>/index.js`，TTL 10s）

## 二、本轮体检结果（2026-09-29 全库巡检）

| 检查项 | 结果 |
|---|---|
| prod 任务 `kind='shell'`（非法值，UI 不渲染 action） | **13 条流水线全部中招**（portal/admin 9/28 已修，ai-agent + 其余 12 条今日已修） |
| dev 任务条件 `DEPLOY_ENV != local`（prod 发布被 dev 截胡） | **12 条中招**（今日已全部改 `== dev`） |
| prod `write-version` 脚本丢续行符 + JSON 转义（bash 语法错误） | 12 条同款（今日已重写为修正版） |
| 终验：226 个动作脚本 bash -n / kind / condition | **0 错误** |

根因：这批 prod 任务是**当初一次性裸 SQL 插入**的 —— 插入时丢 `\` 续行符 → bash -n 过不了 → 走正常保存通道永远失败 → kind 留下占位的 `shell`。**病根是动作脚本以裸文本活在 DB 里，没有 git 治理。**

## 三、结构性问题清单

| # | 问题 | 影响 | 级别 |
|---|---|---|---|
| 1 | 动作脚本存 DB 裸文本，无版本控制、无 review、可被直插污染 | 本次 13 条流水线病变的根因；坏了无处 diff | P0 |
| 2 | 编排数据无巡检：脏数据躺了 5 天无人知（用户界面发现） | prod 发布静默走错分支/假成功 | P0 |
| 3 | env 分流靠 condition 字符串 + sort 顺序首个命中 | `!= local` 一处写错就截胡 prod（已发生 12 次） | P0 |
| 4 | 版本真相源三处并存，双写靠动作脚本自觉 | 漏写一处 → 控制台显示假版本（发生过） | P1 |
| 5 | prod 发布链路 SPOF：控制台在 dev 机，prod 靠 dev 机 SSH 直连 | dev 机挂 = 全平台发不了 prod | P1 |
| 6 | 回滚纯手工（.bak 指针 + previous_version 手查） | 故障时 30s 回退依赖人肉记忆 | P1 |
| 7 | 产物未预压缩（Node compression 动态 gzip） | 首屏性能税（P1-2 待办已有） | P1 |
| 8 | 无发布锁：并发发布靠人工约定 | 双流水线同时跑同一模块会互相踩 | P2 |
| 9 | dev/prod 配置漂移靠人工 sed（3000 系端口坑发生过） | 每次加服务都可能踩 | P2 |

## 四、优化路线图

### P0（本周，防再犯）
1. **巡检固化**：把今日巡检脚本固化成 `scripts/pipeline/pipeline-lint.mjs`（ssh 拉树 → kind 白名单 / condition 完备性 / 逐脚本 bash -n / managed 动作不 sa 注入），接 CI 每日跑 + 质量门禁可选。
2. **动作脚本 git 化（真相源倒置）**：`scripts/pipeline-actions/<pipeline>/<task>/<sort>-<name>.sh` 入库；提供 seed 脚本走**编排 API**（非裸 SQL）幂等 upsert 到 dev 控制台。DB 里的副本视为缓存，可随时重建。
3. **env 分流校验器**：编排保存时校验「local/dev/prod 三任务条件集合 = 全集且互斥」（缺 prod 或条件重叠直接 400）。服务端 20 行代码，一次杜绝截胡类 bug。

### P1（两周内）
4. **一键回滚**：控制台发布详情页加「回滚到 previous_version」按钮（数据已有，拼动作：指针对调 + .bak 恢复 + 版本表 update + 后端 pm2 restart）。
5. **legacy 表只读化**：后端服务指针迁进 NEW 域后，`deploy_deployments` 转 read-only（当前已是双写，只差后端指针载体）。
6. **产物预压缩**：构建时产 .gz/.br，gateway 静态服务优先发预压缩文件，摘掉动态 compression。
7. **prod 发布验收入流水线**：verify 动作后追加「__version__ + 指针内容 + 页面 200」自动断言（目前靠人工 curl 清单）。

### P2（一个月内）
8. **发布互斥锁**：同 module 同 env 并发提交直接 409（DB 唯一约束 or Redis 锁）。
9. **控制台 runner 分离**：prod 机跑轻量 runner 拉任务（消除 dev 机 SPOF + 免 prod SSH 大开），与 prod 转 git 的轨道一致。
10. **配置漂移校验**：`scripts/verify-env.mjs` 对比 .env.example / 各服务 .env / 端口约定（6000 系），发布前跑。

## 五、本轮变更记录

- ai-agent + 12 条流水线：prod 任务 kind `shell→script`、dev 条件 `!= local→== dev`、prod write-version 脚本重写（续行符 + JSON 转义 + versionTag 纯 commit）——全部走编排 API（带审计），终验 0 错误。
- 修复脚本：dev 机 `/tmp/fix-all-pipelines.js`（可复用，幂等）。
