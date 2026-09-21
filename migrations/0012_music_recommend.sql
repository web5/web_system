-- 0012 · 音乐推荐：渠道配置表 + 用户口味档案表（一期：推荐卡片 + 跳转 QQ音乐）
--
-- 背景：用户表达听歌意图时，Agent 出「歌曲卡片」并引导去外部音乐小程序听；
--       跳转目标不能硬编码（换渠道要提审），口味要跨会话记住（会话级 summary 做不到）。
-- 目标库：web_system（ai-agent 侧；与 agent_conversations 同库）
-- 存量和兼容：纯新增表，无存量数据；app_id 先写占位 PENDING_QQMUSIC，
--             真机确认后 UPDATE 一行即可（卡片在占位态降级为「复制歌名去搜索」）

CREATE TABLE IF NOT EXISTS music_providers (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code            VARCHAR(64)  NOT NULL COMMENT '渠道编码：qqmusic / kugou_plugin',
  name            VARCHAR(128) NOT NULL COMMENT '展示名，用于按钮文案「去 XX 听」',
  app_id          VARCHAR(64)  NULL     COMMENT '目标小程序 appid / 插件 appid，未确认时为占位 PENDING_QQMUSIC',
  entry_type      VARCHAR(32)  NOT NULL DEFAULT 'mini_program' COMMENT '入口类型：mini_program=跳转小程序 / plugin=插件 / h5=外链',
  search_template VARCHAR(512) NULL     COMMENT '定位模板，含 {keyword} 占位',
  icon            VARCHAR(255) NULL     COMMENT '渠道图标',
  sort            INT          NOT NULL DEFAULT 100 COMMENT '排序，越小越优先',
  enabled         TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '是否启用；关闭后不下发给 Agent',
  created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  updated_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  deleted_at      DATETIME(6)  NULL     COMMENT '软删除时间，NULL 表示未删除',
  PRIMARY KEY (id),
  UNIQUE KEY uk_music_providers_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='音乐播放渠道配置';

CREATE TABLE IF NOT EXISTS user_taste_profiles (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    VARCHAR(64) NOT NULL COMMENT '用户 id',
  namespace  VARCHAR(32) NOT NULL DEFAULT 'music' COMMENT '偏好域：music / 预留',
  data       JSON        NOT NULL COMMENT '偏好数据：likes / dislikes / note',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
  deleted_at DATETIME(6) NULL     COMMENT '软删除时间，NULL 表示未删除',
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_taste_user_ns (user_id, namespace)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户偏好档案（跨会话）';

-- 一期渠道：QQ音乐小程序跳转。app_id 占位，真机确认后 UPDATE 即可。
INSERT INTO music_providers (code, name, app_id, entry_type, sort, enabled)
SELECT 'qqmusic', 'QQ音乐', 'PENDING_QQMUSIC', 'mini_program', 100, 1
WHERE NOT EXISTS (SELECT 1 FROM music_providers WHERE code = 'qqmusic');
