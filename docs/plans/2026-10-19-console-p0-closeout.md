# Console P0 剩余项收口（2026-10-19）

> 本文记录 dev P0 验收时点。用户现已授权独立分支、提交和草稿 PR；后续运行根统一改动及维护窗口边界见 `docs/development/release-reviews/2026-10-19-console-delivery.md`。不能把新增目录迁移代码的单测通过当作生产实际已切换。

## 范围与状态

继续 Console P0，不启动 Content-hub 或 AI Agent 架构改造。Admin 管理后台 `/admin/login` 与 Beehive 发布控制台 `/console/login` 分开验收；前者通过不能替代后者。

本轮 dev 范围的发布/恢复及独立 Beehive 登录态检查已完成，Shell 入口说明、HTML 版本候选及 dev 手动探活遗留均已修复并实测。手动探活显式改用登记目标机的 SSH 通道，服务详情和列表实际点击均返回 HTTP 200，未开放业务公网端口，也未把控制台本机冒充目标机。生产推广、云库适用性和源码合入另行处理，不以 dev 结果替代。

## 已验证修复

- 本地 97 个测试套件、1156 项测试通过，Nest 构建和 `git diff --check` 通过；独立 Console 前端 vue-tsc 与 Vite 构建通过。
- dev Console 该轮后端部署 `console-p0-20261019-1792378478196` 成功；41 个实体文件、只读 schema 差异 0；未执行 DDL。源码变更集摘要 `59968e1a03f34bbea9005902371ad2c0041a4b8338cd666a3c6d523eaf519bdc`。仅新增运行配置 `SERVICE_HEALTH_TRANSPORT_DEV=ssh`，prod/local 未配置仍 direct。该轮制品来自未提交快照；当前代码交付状态以独立分支/PR 的 Git 记录为准。
- Shell 回滚按 HTML 入口校验，经应用域切版本并刷新缓存，不落入 JS 指针或后端回退链。
- 后端采用带身份、平台/Node ABI 和文件摘要的隔离运行包；投递不可覆盖同名不同内容版本，运行依赖安装在原仓库外，通过单服务 dist 链接激活。探活必须核对 HTTP、PM2 与监听端口归属，失败恢复原 dist。
- 已知运行仓库 reset 旧模板在提交/审批恢复/实际执行前被拒绝；真实 dev 提交已获得 409，未创建新运行记录。该门禁不是任意 shell 安全沙箱。
- `tpl-todo-service-dev` revision 7 仅迁移 dev 动作并增加仅 dev 生效的打包动作；其他动作、prod 行为、审批、指针保留。未迁移的危险 prod 发布被门禁拦截，现有 prod 服务不受影响。
- 构建完成进入交付/激活后不允许强杀取消；构建中取消保留标记和锁直到执行器停止，防止最后动作完成误写成功。后台模块类型不再误走前端指针收尾，回滚全程持有操作锁。

## 后端恢复基线纠正

todo-service/dev 原账本为 `6e7b2690`，但留存目录仅有 tsbuildinfo，不能充当可回退版本。已完整保存真实健康运行的 43 个文件，内容摘要 `bf052d62778059fe610001e69239496ddc7d2157a29383c6a0e0b2b1882af772`，通过内部版本/指针 API 注册 `runtime-checkpoint/1792343661257`。

这是明确标注的运行现场检查点，不宣称 Git commit；注册时没有重启服务或改变运行字节。元数据清单置于备份目录，不混进 43 文件产物。后续演练恢复该真实基线，不能把损坏旧目录或手工恢复旧 SQL 伪装成成功。

## 执行记录

- 后端首轮 `1792351508752-k7et7pg`：编译通过，隔离依赖打包失败；没有进入审批/投递/重启。定位为 pnpm 10 legacy deploy 在 hoisted 工作区不读锁、重新解析 root 的 sharp 版本且缺少离线元数据；禁止用联网重试掩盖版本漂移。改用本次命令开启 workspace 注入与 isolated linker 的共享锁 deploy，离线实测成功打出 20739 文件，仅包含目标服务及所需共享包，原仓库配置不改。
- `tpl-todo-service-dev` revision 8 更新嵌入的打包程序。第二轮 `1792351918022-4ddkves` 构建、封包、2 实体只读 schema 差异 0 均通过；并发探针却发现原 submit 只检查 running，不检查 awaiting-approval，新建了 `1792351973971-dy8ow0h`。两个实例均停在审批点，未批准，随后通过正式取消 API 关闭并保留记录，避免被覆盖的待审批产物继续流转。
- 追加修复：提交检查覆盖 pending/running/两类待审批，并以独立原子提交锁覆盖检查到实例保存；避免并发请求同时通过检查。已全量回归并部署 dev。
- 新实例 `1792352344640-0s1g1ac` 的隔离包完整性、全 commit、目标版本目录不存在、2 实体 schema 差异 0 均通过；待审批时重复提交已真实返回 409，记录数量不变。批准后在交付阶段尝试取消真实返回 409，后台执行未被中断。
- 同一实例发布成功：todo-service 单服务 PID `1075175`、HTTP 200、6005 端口确属该 PID；激活到 `/home/ubuntu/web_system_runtimes/todo-service/todo-service-dev/e1618537`，实际 reflect-metadata 从该版本私有 node_modules 解析，不再借用运行仓库。verify 为幂等复验，没有第二次重启；指针是完整 `todo-service-dev/e1618537`。运行仓库 HEAD、锁文件、共享包 dist 摘要及其他业务 PID 全部保持。
- 正式模块回滚 task `1792352620546-ikwou2v` 成功恢复 `runtime-checkpoint/1792343661257`；独立 HTTP 200 和端口归属再次通过，恢复后的 43 文件摘要与演练前完全相同。没有通过 SQL 修饰旧错误版本或执行整站回滚。
- 追加防护：远端格式探针失败必须拒绝落地，不能猜为旧格式并复制新运行包根目录；回归覆盖探针失败和激活失败两种禁止降级路径。
- Shell 实例 `1792352769164-o8j7rll` 完成构建→审批→投递→激活。HTML、favicon、JS/CSS 分包等 12/12 资源均 HTTP 200、MIME 正确、磁盘与构建摘要一致；根页面引用新版本。发布后应用域 current=e1618537、previous=a82270f9，没有生成 JS 指针。
- 真实 Chrome 打开 dev 域名，Shell 自动加载 Portal，实际 DOM 中脚本与样式使用 dev/e1618537，浏览器错误日志为空；未操作用户会话内容或发起对话。正式 Shell 模块回滚 task `1792352926107-hzxqt70` 成功，应用域恢复 current=a82270f9、previous=e1618537；根页面、3 个入口资源和 Chrome 实际脚本均确认恢复原版本。
- 补齐发布验证接口遗漏：原 Shell 返回 unknown，因为只认微前端 JS 指针；现按应用域指针和现采 HTML 入口判据验证。真实接口对当前 a82270f9 返回 verified，对已回退的 e1618537 返回 failed，即使原发布 run 是 succeeded 也不会误报当前生效。release-plan 同样读取应用域指针，不能把 legacy 发布记录误作回退后的当前版本。
- Console 登录态浏览器验收：本人已登录 dev Console，已在实际 Chrome 验证仪表盘、流水线列表、Shell 实例执行画布/日志/历史、应用列表与 Shell/Admin 部署页、服务详情、主机管理、审计日志。只读查看和打开/取消弹窗，不执行版本切换、回滚、删除或生产审批。

## 登录态续验发现与修复

1. Shell 页面错误地显示 `index.js` 入口及“改写 JS 指针”的提示。前端 `AppDetail.vue` 已按 Shell 类型显示 `index.html`，切换/回滚提示说明应用域指向与网关缓存，Admin 仍保持 JS 语义。
2. Shell 切换弹窗没有历史候选：应用域 API 对 site-version 直接返回空数组，底层列版本又只查 JS。现按请求环境按需列 HTML 版本，本机及远端实现均覆盖；当前/上一版本标记保留。Shell 入口 URL 同步修正为 `<envId>/<version>/index.html`。概览不额外批量探测生产产物。
3. 前端部署 `console-ui-p0-20261019-1792376365409`：真实服务根 `/data/web_system/apps/deploy-console/dist`，不是 gateway/public/console。保留旧 hash 资源，先校验/添加新资源、最后原子替换 index，失败可恢复旧入口；53/53 文件经真实 HTTP 的状态、MIME 和构建摘要核对通过。前端部署没有重启进程或修改发布记录。
4. 新前后端刷新后，Shell 弹窗显示当前 a82270f9、可选 e1618537；仅查看并取消，未提交切换。Admin 当前 e2a2866c、上一 e1618537，仍使用 JS 指针。后端重启窗口曾出现一次 502，候选探活恢复后已重新验证页面正常，不作为零停机发布承诺。

## dev 手动探活网络路径（已修复）

- 实际点击 Todo/dev 的“探活”后，UI 如实返回公网地址请求被中止，不能记为健康通过。
- 只读复查同一已登记 dev 主机：`127.0.0.1:6005/health` 返回 200（约 7ms），登记公网地址的同端口请求约 3.5s 超时。隔离后端的进程和端口归属验证仍通过，恢复后的 43 文件摘要不变。
- 已确认两条网络路径结果不同；尚未证明具体原因是云防火墙、同机公网回环还是路由策略。不自动开放业务端口，不改上游为 localhost 掩盖失败，也不把此前本机发布探活 200 当作公网可达证据。
- 用户明确授权修复 dev 后，采用按环境显式选择的目标机内探活通道，而非放开公网端口。通过 `SshExecService.configForHost` 使用服务环境绑定的具体主机与既有凭据，目标机请求登记端口的 `127.0.0.1`；不使用环境默认机，不在 SSH 失败时回落控制台本机。显式 upstream URL 保持直连，非 PM2 不猜测 loopback。
- HTTP 请求有硬超时、不跟随重定向、不输出健康响应体；SSH/HTTP 失败、异常输出、不一致的 ok/status、错误端口/路径等必须失败。新增 24 项回归覆盖，prod/local 保持原 direct 分支，现场仅点击 dev。
- 实际 Chrome 服务详情 dev 探活：`dev 健康（200，614ms）→ http://127.0.0.1:6005/health（SSH 目标机 …）`；服务列表 dev 徽标再次探活：HTTP 200、623ms，均明确标明 SSH 路径，未把公网地址误报为已连通。
- 前端最新部署 `console-ui-p0-20261019-1792378566424`，53/53 文件状态、MIME 与构建摘要核对通过，旧资源继续保留。原公网 HTTP 对照仍超时，符合“未开放端口、未改业务上游”的实际边界；此修复解决服务健康探测路径，不宣称公网端口已恢复可达。
- 修复后应用/部署指针、原 prod 审批、Todo 进程与 43 文件运行字节、共享包摘要及其他业务进程保持；无活跃 run、task 或锁。详情和列表均在本人已有登录态下实测，无需再次登录或提供密码。

## 最终状态及能力边界

- 后端当前为真实运行检查点，43 文件与演练前摘要相同；Shell 应用域当前 a82270f9；Admin 当前 e2a2866c、previous=e1618537。
- 演练结束无活跃发布 run、部署 task 或发布锁；原 prod 审批保持 pending。其他应用指针、业务 PID、运行仓库 HEAD/锁文件/共享包 dist 摘要保持。
- Shell 的 legacy deploy_deployments 可能保留最近发布 e1618537；其运行真相源是已恢复 a82270f9 的 deploy_app_env_versions。没有手改 SQL 美化两表，提案/验证已改用正确域。
- release-verify 仍按既有契约列出自动业务 HTTP 和配置摘要 knownGaps。本轮的真实 HTTP/浏览器/摘要证据由独立验收补齐，不宣称接口已经实现自动端到端 HTTP 或配置校验。云库镜像只做桩测试，不宣称生产迁移完成。

## 安全边界与证据

原 prod run `1790749237193-nn2w34p` / 审批 `1790749249606-mncs8f1` 必须保持 pending，不批准、不取消。无生产发布、无 DDL、无整站 MCP gateway 部署。Admin/dev 基线维持 `e2a2866c`，previous 为 `e1618537`；Shell/dev 演练前为 `a82270f9`。

私有证据目录 `/tmp/web-system-console-p0-20261019/` 保存测试、部署、迁移备份回执、检查点与真实执行结果；含环境/数据库快照不可提交。模板迁移备份位于 dev 的 `/home/ubuntu/web_system_backups/console-p0-backend-template-20261019-1792351475743`。

最终断言汇总为该私有目录的 `final-summary.json`：核对最新源码指纹、1156 项测试、前端 53 文件、发布/恢复与正反向 API 判据、原 prod 审批、共享运行字节和其他进程、无遗留任务或锁。登录前及探活修复前记录分别保留在 `final-summary-before-ui.json`、`final-summary-before-health-fix.json`；最新结果记录 dev SSH 手动探活两处真实 UI 均通过，公网对照仍不通、生产推广未执行。不把本轮 dev 收口等同生产验收或整体长期架构完成。
