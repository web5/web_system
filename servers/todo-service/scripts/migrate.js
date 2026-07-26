const mysql = require('mysql2/promise');

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE || 'web_system',
  });

  if (!process.env.DB_PASSWORD) {
    console.error('[Migrate] 错误：DB_PASSWORD 环境变量未设置，请先 export DB_PASSWORD=xxx');
    process.exit(1);
  }

  console.log('[Migrate] 数据库连接成功');

  const sql = `
    CREATE TABLE IF NOT EXISTS todo_tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      status ENUM('pending', 'in_progress', 'completed', 'overdue', 'cancelled') DEFAULT 'pending',
      priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
      category JSON,
      due_date DATETIME,
      completed_at DATETIME,
      user_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      INDEX idx_user_id (user_id),
      INDEX idx_status (status),
      INDEX idx_due_date (due_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  try {
    await connection.execute(sql);
    console.log('[Migrate] todo_tasks 表创建成功');
  } catch (error) {
    console.error('[Migrate] 迁移失败:', error.message);
    // 如果表已存在，忽略错误
    if (error.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('[Migrate] 表已存在，跳过创建');
    } else {
      throw error;
    }
  }

  await connection.end();
  console.log('[Migrate] 迁移完成');
}

migrate().catch(console.error);
