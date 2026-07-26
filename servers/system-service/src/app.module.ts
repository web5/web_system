import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'path';
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
        };
      },
    }),
    SettingsModule,
    OperationLogsModule,
    BianbianAdminModule,
  ],
})
export class AppModule {}
