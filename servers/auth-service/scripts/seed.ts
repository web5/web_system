import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

const dataSource = new DataSource({
  type: (process.env.DB_TYPE || 'postgres') as any,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'web_system',
  password: process.env.DB_PASSWORD || 'web_system123',
  database: process.env.DB_DATABASE || 'web_system',
  entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
  synchronize: false,
});

async function seed() {
  console.log('🌱 开始初始化数据库...');

  await dataSource.initialize();
  console.log('✅ 数据库连接成功');

  const userRepository = dataSource.getRepository('users');

  // 检查是否已存在 admin 用户
  const existingAdmin = await userRepository.findOne({
    where: { username: 'admin' },
  });

  if (existingAdmin) {
    console.log('⚠️  管理员用户已存在，跳过创建');
    console.log('   用户名: admin');
    console.log('   请尝试使用现有密码登录，或手动更新密码');
  } else {
    // 创建默认管理员用户
    const hashedPassword = await bcrypt.hash('admin123', 10);

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
    console.log('✅ 默认管理员用户创建成功！');
    console.log('   用户名: admin');
    console.log('   密码: admin123');
    console.log('   ⚠️  请在生产环境中立即修改默认密码！');
  }

  // 创建测试用户
  const existingTestUser = await userRepository.findOne({
    where: { username: 'test' },
  });

  if (!existingTestUser) {
    const hashedPassword = await bcrypt.hash('test123', 10);

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
    console.log('✅ 测试用户创建成功！');
    console.log('   用户名: test');
    console.log('   密码: test123');
  }

  await dataSource.destroy();
  console.log('🎉 数据库初始化完成！');
}

seed().catch((error) => {
  console.error('❌ 初始化失败:', error);
  process.exit(1);
});
