-- Todo List 数据库迁移
-- 执行日期: 2026-07-03
-- 描述: 创建 todo_tasks 表

CREATE TABLE IF NOT EXISTS `todo_tasks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `status` ENUM('pending', 'in_progress', 'completed', 'overdue', 'cancelled') DEFAULT 'pending',
  `priority` ENUM('low', 'medium', 'high') DEFAULT 'medium',
  `category` JSON,
  `due_date` DATETIME,
  `completed_at` DATETIME,
  `user_id` INT NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME,
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_status` (`status`),
  INDEX `idx_due_date` (`due_date`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 说明:
-- 1. 使用 InnoDB 引擎支持外键
-- 2. category 字段使用 JSON 类型存储数组
-- 3. deleted_at 用于软删除
-- 4. 索引优化常用查询
