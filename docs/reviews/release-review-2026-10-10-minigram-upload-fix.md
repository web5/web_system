# 发布评审：小程序 upload.js 修复（2026-10-10）

## 变更
`apps/kedou-ai-minigram/scripts/upload.js`：改为 miniprogram-ci 正确调用姿势——
先 `new ci.Project({...})` 构造实例，再 `upload({ project, version, desc, setting })`。
原实现把 project 配置直接展开进 upload 参数，运行时报
`lack of parameter: "project"`（附带的 report.js `reading 'appid'` 为同一根因）。

## 门禁核对（对照 release-review-checklist）
- 面向：小程序 CI 出码脚本，不触碰服务端发布面（无 pm2/.env/迁移/微前端指针/流水线动作）→ 与 PR #292 同判：服务端门禁 N/A
- E3 变更后验证：dev 执行机实跑 `upload.js` → 上传成功（zip 313KB，version=1.0.0，robot=1），公众平台开发版本列表可见
- 去敏：无 IP / 用户名 / 绝对路径新增
- 私钥：仍由 gitignore 覆盖，未入库

## 结论
阻塞 0 / 重要 0。Release: pass
