-- 0017 · 管线运行批次表 content_pipeline_runs
--
-- 背景：手动运行一条管线要跑完「采集 → LLM 摘要 → 渲染 → 发布」，实测 30 秒起步。
-- 同步接口会被链路上的三道超时依次掐断（前端 10s → 网关 content-admin 通道 30s → nginx 60s）：
-- 前端只看到「网络错误」，但后端仍在跑、内容仍会真的投出去 —— 用户以为失败于是再点一次，
-- 结果就是草稿箱里多出一条重复内容。
-- 所以手动运行改为异步：受理即返回 job_id，后台执行，前端轮询查结果。本表即该 job 的载体。
--
-- 适用：dev / prod 都手跑一遍（NODE_ENV=production 时 TypeORM synchronize 关闭）。
-- 幂等：先判表是否存在，存在则跳过建表。

SET @db = DATABASE();
SET @exists = (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'content_pipeline_runs'
);

SET @sql = IF(
  @exists = 0,
  "CREATE TABLE `content_pipeline_runs` (
     `id` bigint NOT NULL AUTO_INCREMENT,
     `pipeline_code` varchar(64) NOT NULL COMMENT '管线 code',
     `trigger_type` varchar(16) NOT NULL DEFAULT 'manual' COMMENT '触发方式 manual | schedule',
     `status` varchar(16) NOT NULL DEFAULT 'running' COMMENT 'running | ok | failed',
     `started_at` datetime(6) DEFAULT NULL COMMENT '开始时间',
     `finished_at` datetime(6) DEFAULT NULL COMMENT '结束时间',
     `duration_ms` int DEFAULT NULL COMMENT '耗时（毫秒）',
     `collected` int NOT NULL DEFAULT 0 COMMENT '采集条数',
     `new_items` int NOT NULL DEFAULT 0 COMMENT '新入库条数',
     `published` int NOT NULL DEFAULT 0 COMMENT '成功发布数',
     `errors` int NOT NULL DEFAULT 0 COMMENT '失败数',
     `error_msg` varchar(512) DEFAULT NULL COMMENT '失败原因',
     `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
     `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
     PRIMARY KEY (`id`),
     KEY `idx_pr_code_status` (`pipeline_code`,`status`)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管线运行批次'",
  "SELECT 'content_pipeline_runs already exists, skip'"
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
