import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { EmailModule } from './email/email.module';
import { PermissionModule } from './permission/permission.module';
import { GlossaryModule } from './glossary/glossary.module';
import { UserMemoryModule } from './memory/user-memory.module';
import { UserTasteModule } from './user-taste/user-taste.module';
import { InternalModule } from './internal/internal.module';
import { HealthModule } from './health/health.module';
import { User } from './user/user.entity';
import { McpApiKeyEntity } from './api-key/entities/mcp-api-key.entity';
import { McpKeyCodeEntity } from './api-key/entities/mcp-key-code.entity';
import { PermissionEntity } from './permission/entities/permission.entity';
import { RoleEntity } from './permission/entities/role.entity';
import { RolePermissionEntity } from './permission/entities/role-permission.entity';
import { GlossaryEntryEntity } from './glossary/glossary-entry.entity';
import { UserMemoryEntity } from './memory/user-memory.entity';
import { UserTasteProfileEntity } from './user-taste/user-taste-profile.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        // 平台下发（配置中心 → .env.generated，流水线 restart 脚本落盘；删文件即回退到 .env）
        // ⚠️ 必须排在 .env 之前：@nestjs/config 先出现者优先
        path.resolve(__dirname, '../.env.generated'),
        path.resolve(__dirname, '../.env'),   // servers/user-service/.env（兼容 dist/src 运行）
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get('DB_TYPE', 'postgres');
        const entities = [User, McpApiKeyEntity, McpKeyCodeEntity, PermissionEntity, RoleEntity, RolePermissionEntity, GlossaryEntryEntity, UserMemoryEntity, UserTasteProfileEntity];
        if (dbType === 'mysql') {
          return {
            type: 'mysql',
            host: configService.get('DB_HOST', 'localhost'),
            port: configService.get<number>('DB_PORT', 3306),
            username: configService.get('DB_USERNAME', 'root'),
            password: configService.get('DB_PASSWORD', ''),
            database: configService.get('DB_DATABASE', 'web_system'),
            entities,
            extra: {
              connectionLimit: 20,
              connectTimeout: 10000,
              waitForConnections: true,
            },
            synchronize: configService.get('NODE_ENV') !== 'production',
            namingStrategy: new SnakeNamingStrategy(),
            logging: configService.get('NODE_ENV') === 'development',
          };
        }
        return {
          type: 'postgres',
          host: configService.get('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get('DB_USERNAME', 'web_system'),
          password: configService.get('DB_PASSWORD', ''),
          database: configService.get('DB_DATABASE', 'web_system'),
          entities,
          extra: {
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
          },
          synchronize: configService.get('NODE_ENV') !== 'production',
          logging: configService.get('NODE_ENV') === 'development',
        };
      },
    }),
    UserModule,
    AuthModule,
    ApiKeyModule,
    EmailModule,
    PermissionModule,
    GlossaryModule,
    UserMemoryModule,
    UserTasteModule,
    InternalModule,
    HealthModule,
  ],
})
export class AppModule {}
