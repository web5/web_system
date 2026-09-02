import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { ApiKeyModule } from './api-key/api-key.module';
import { PermissionModule } from './permission/permission.module';
import { User } from './user/user.entity';
import { McpApiKeyEntity } from './api-key/entities/mcp-api-key.entity';
import { McpKeyCodeEntity } from './api-key/entities/mcp-key-code.entity';
import { PermissionEntity } from './permission/entities/permission.entity';
import { RoleEntity } from './permission/entities/role.entity';
import { RolePermissionEntity } from './permission/entities/role-permission.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(__dirname, '../.env'),   // servers/user-service/.env（兼容 dist/src 运行）
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get('DB_TYPE', 'postgres');
        const entities = [User, McpApiKeyEntity, McpKeyCodeEntity, PermissionEntity, RoleEntity, RolePermissionEntity];
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
    PermissionModule,
  ],
})
export class AppModule {}
