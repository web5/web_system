-- 0025 · 新概念英语课文（NCE2）入库表
-- 字段与 data/lessons.json 一一对应：标量落独立列，数组/对象落原生 JSON 列，不做二次拆表。
-- 版权：教材内容仅供个人学习，本表不对外分发。
-- 时间列统一 DATETIME(3)，与实体 precision:3 对齐（避开 TypeORM 1.1.x 的 datetime(6) 漂移）。
CREATE TABLE IF NOT EXISTS `nce_lessons` (
  `id`               INT UNSIGNED  NOT NULL AUTO_INCREMENT COMMENT '主键',
  `book`             VARCHAR(16)   NOT NULL DEFAULT 'NCE2' COMMENT '册别',
  `book_title`       VARCHAR(128)  NOT NULL DEFAULT ''     COMMENT '教材名',
  `lesson_no`        INT UNSIGNED  NOT NULL                COMMENT '课号（对应 lessons.json 的 id）',
  `title`            VARCHAR(255)  NOT NULL DEFAULT ''     COMMENT '英文标题',
  `title_cn`         VARCHAR(255)  NULL DEFAULT NULL       COMMENT '中文标题',
  `lead_question`    VARCHAR(512)  NULL DEFAULT NULL       COMMENT '英文导入问题',
  `lead_question_zh` VARCHAR(512)  NULL DEFAULT NULL       COMMENT '中文导入问题（leadQuestionCn）',
  `text`             MEDIUMTEXT    NULL                    COMMENT '英文课文全文',
  `text_source`      VARCHAR(16)   NOT NULL DEFAULT 'lrc'  COMMENT '课文来源：xdf 权威全文 / lrc 字幕拼接',
  `lines`            JSON          NULL                    COMMENT '逐句双语 [{en,cn}]',
  `translation`      MEDIUMTEXT    NULL                    COMMENT '连贯参考译文',
  `words`            JSON          NULL                    COMMENT '生词 [{word,phonetic,pos,def,example}]',
  `exercises`        JSON          NULL                    COMMENT '习题 [{q,options,answer,exp}]',
  `sources`          JSON          NULL                    COMMENT '来源 URL 数组',
  `fetched_at`       DATETIME(3)   NULL DEFAULT NULL       COMMENT '抓取时间',
  `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_nce_lessons_book_no` (`book`, `lesson_no`),
  KEY `idx_nce_lessons_no` (`lesson_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='新概念英语课文（字段对齐 lessons.json）';
