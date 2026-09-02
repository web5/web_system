-- =============================================================================
-- 0004_mcp_jobs.sql
-- MCP 网关：新增「任务索引表」mcp_jobs，用于 jobId → 模块的路由映射。
-- 适用范围：web_system 库（MySQL 8，utf8mb4）。
-- 执行顺序：在 0001～0003 之后，于生产库按段执行；本脚本不自动运行。
--
-- 背景：发布流水线等长任务由 mcp-gateway 统一对外提供 get_job_status / cancel_job，
--       需要知道某个 jobId 属于哪个后端模块。任务真实状态仍归各后端
--       （deploy_pipelines / agent_run），本表只做路由，不存状态。
-- =============================================================================

CREATE TABLE IF NOT EXISTS `mcp_jobs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                         COMMENT '自增 ID',
  `job_id`      VARCHAR(64)     NOT NULL                                        COMMENT '任务 ID（后端生成）',
  `code_key`    VARCHAR(64)     NOT NULL                                        COMMENT '模块标识，如 deploy',
  `tool_name`   VARCHAR(64)     NOT NULL                                        COMMENT '任务工具名，如 publish_pipeline',
  `operator`    VARCHAR(64)     NULL    DEFAULT NULL                            COMMENT '提交者 ownerId',
  `created_at`  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6)           COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mcp_jobs_job_id` (`job_id`),
  KEY `idx_mcp_jobs_code_key` (`code_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='MCP 任务索引（jobId 到模块的路由映射）';
