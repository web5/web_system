import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'path';
import { UploadModule } from './upload/upload.module';
import { SnakeNamingStrategy } from '@web-system/shared';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 显式指定配置路径：统一读本服务目录 servers/upload-service/.env
      // （不再依赖 cwd 的根 .env，避免换目录启动就读不到配置）
      envFilePath: [path.resolve(__dirname, '../.env')],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'mysql',
        host: cfg.get('MYSQL_HOST'),
        port: Number(cfg.get('MYSQL_PORT') || 3306),
        username: cfg.get('MYSQL_USER'),
        password: cfg.get('MYSQL_PASSWORD'),
        database: cfg.get('MYSQL_DB'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        // 生产环境务必置 false，改用 migrations/ 下的迁移脚本
        synchronize: cfg.get('NODE_ENV') !== 'production',
        charset: 'utf8mb4',
        timezone: 'local',
        namingStrategy: new SnakeNamingStrategy(),
      }),
    }),
    UploadModule,
  ],
})
export class AppModule {}
