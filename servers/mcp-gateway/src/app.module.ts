import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'path';
import { SnakeNamingStrategy } from '@web-system/shared';
import { McpModule } from './mcp/mcp.module';
import { McpModuleEntity } from './mcp/entities/mcp-module.entity';
import { McpToolEntity } from './mcp/entities/mcp-tool.entity';
import { McpJobEntity } from './mcp/entities/mcp-job.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [path.resolve(__dirname, '../.env')],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbType = configService.get('DB_TYPE', 'mysql');
        const entities = [McpModuleEntity, McpToolEntity, McpJobEntity];
        if (dbType === 'mysql') {
          return {
            type: 'mysql' as const,
            host: configService.get<string>('DB_HOST', 'localhost'),
            port: configService.get<number>('DB_PORT', 3306),
            username: configService.get<string>('DB_USERNAME', 'root'),
            password: configService.get<string>('DB_PASSWORD', ''),
            database: configService.get<string>('DB_DATABASE', 'web_system'),
            entities,
            synchronize: configService.get('NODE_ENV') !== 'production',
            namingStrategy: new SnakeNamingStrategy(),
            charset: 'utf8mb4',
          };
        }
        return {
          type: 'postgres' as const,
          host: configService.get<string>('DB_HOST', 'localhost'),
          port: configService.get<number>('DB_PORT', 5432),
          username: configService.get<string>('DB_USERNAME', 'web_system'),
          password: configService.get<string>('DB_PASSWORD', ''),
          database: configService.get<string>('DB_DATABASE', 'web_system'),
          entities,
          synchronize: configService.get('NODE_ENV') !== 'production',
        };
      },
    }),
    McpModule,
  ],
})
export class AppModule {}
