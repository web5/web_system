import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import * as path from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { AuthGuard } from './auth/auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { DatabaseExplorerModule } from './database-explorer/database-explorer.module';
import { SettingsModule } from './settings/settings.module';
import { OperationLogsModule } from './operation-logs/operation-logs.module';
import { BianbianAdminModule } from './bianbian-admin/bianbian-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(__dirname, '../.env'),   // servers/system-service/.env（兼容 dist/src 运行）
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbType = config.get<string>('DB_TYPE', 'postgres');
        return {
          type: dbType as 'postgres',
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 5432),
          username: config.get<string>('DB_USERNAME', 'web_system'),
          password: config.get<string>('DB_PASSWORD', ''),
          database: config.get<string>('DB_DATABASE', 'web_system') || 'web_system',
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          extra: {
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
          },
          synchronize: config.get<string>('NODE_ENV', 'development') !== 'production',
          namingStrategy: new SnakeNamingStrategy(),
        };
      },
    }),
    // 只读连接：数据浏览器专用（DatabaseExplorerService 注入 'readonly'）
    // 未配 DB_READONLY_USER 时回落主账号并告警 —— 生产环境必须配置只读账号
    TypeOrmModule.forRootAsync({
      name: 'readonly',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const roUser = config.get<string>('DB_READONLY_USER', '') || '';
        if (!roUser) {
          new Logger('DatabaseExplorer').warn(
            'DB_READONLY_USER 未配置，数据浏览器正使用【可写账号】运行，生产环境必须配置只读账号',
          );
        }
        return {
          type: (config.get<string>('DB_TYPE', 'mysql') || 'mysql') as 'mysql',
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 3306),
          username: roUser || config.get<string>('DB_USERNAME', 'web_system'),
          password: roUser
            ? config.get<string>('DB_READONLY_PASSWORD', '')
            : config.get<string>('DB_PASSWORD', ''),
          database: config.get<string>('DB_DATABASE', 'web_system') || 'web_system',
          // 只读连接不挂实体，也永不 synchronize —— 避免误改表结构
          entities: [],
          synchronize: false,
          extra: {
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
          },
        };
      },
    }),
    SettingsModule,
    OperationLogsModule,
    BianbianAdminModule,
    DatabaseExplorerModule,
  ],
  providers: [
    // 顺序敏感：AuthGuard 先注入 request.user，PermissionsGuard 再读 user.roles
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
