import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';

dotenv.config();

const dataSource = new DataSource({
  // 与 app.module.ts 的 ConfigService 读取保持一致。
  // 注意：DB 密码只允许通过 .env / 环境变量注入，禁止在此硬编码。
  type: (process.env.DB_TYPE || 'mysql') as 'mysql',
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306'),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'web_system',
  entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
  synchronize: false,
});

async function seed() {
  console.log('[Seed] 开始初始化数据库...');

  await dataSource.initialize();
  console.log('[Seed] 数据库连接成功');

  const userRepository = dataSource.getRepository('users');

  // 检查是否已存在 admin 用户
  const existingAdmin = await userRepository.findOne({
    where: { username: 'admin' },
  });

  if (existingAdmin) {
    console.log('[Seed] 管理员用户已存在，跳过创建');
    console.log('   用户名: admin');
    console.log('   请尝试使用现有密码登录，或手动更新密码');
  } else {
    // 创建默认管理员用户 — 密码必须通过环境变量 ADMIN_INIT_PASSWORD 指定
    const adminPassword = process.env.ADMIN_INIT_PASSWORD;
    if (!adminPassword) {
      console.error('[Seed] 错误: 未设置 ADMIN_INIT_PASSWORD 环境变量');
      console.error('[Seed] 请设置: export ADMIN_INIT_PASSWORD=<你的安全密码>');
      process.exit(1);
    }
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const adminUser = userRepository.create({
      username: 'admin',
      password: hashedPassword,
      email: 'admin@web-system.com',
      status: 'active',
      roles: ['admin'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await userRepository.save(adminUser);
    console.log('[Seed] 默认管理员用户创建成功！');
    console.log('   用户名: admin');
    console.log('   密码: (由 ADMIN_INIT_PASSWORD 环境变量指定，默认 admin123)');
    console.log('   [Seed] 请在生产环境中立即修改默认密码！');
  }

  // 创建测试用户
  const existingTestUser = await userRepository.findOne({
    where: { username: 'test' },
  });

  if (!existingTestUser) {
    const testPassword = process.env.TEST_INIT_PASSWORD;
    if (!testPassword) {
      console.warn('[Seed] 未设置 TEST_INIT_PASSWORD，将生成随机密码');
    }
    const finalTestPassword = testPassword || crypto.randomUUID().slice(0, 12);
    const hashedPassword = await bcrypt.hash(finalTestPassword, 10);

    const testUser = userRepository.create({
      username: 'test',
      password: hashedPassword,
      email: 'test@web-system.com',
      status: 'active',
      roles: ['user'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await userRepository.save(testUser);
    console.log('[Seed] 测试用户创建成功！');
    console.log('   用户名: test');
    console.log(`   密码: ${finalTestPassword}`);
    console.log('   [Seed] 请妥善保存密码，或通过 TEST_INIT_PASSWORD 环境变量重新指定');
  }

  await dataSource.destroy();
  console.log('[Seed] 数据库初始化完成！');
}

seed().catch((error) => {
  console.error('[Seed] 初始化失败:', error);
  process.exit(1);
});
