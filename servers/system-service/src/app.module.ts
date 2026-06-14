import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsModule } from './settings/settings.module';
import { OperationLogsModule } from './operation-logs/operation-logs.module';
import { BianbianAdminModule } from './bianbian-admin/bianbian-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbType = config.get<string>('DB_TYPE', 'postgres');
        return {
          type: dbType as any,
          host: config.get<string>('DB_HOST', 'localhost'),
          port: config.get<number>('DB_PORT', 5432),
          username: config.get<string>('DB_USERNAME', 'web_system'),
          password: config.get<string>('DB_PASSWORD', 'web_system123'),
          database: config.get<string>('DB_DATABASE', 'web_system') || 'web_system',
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: true,
        };
      },
    }),
    SettingsModule,
    OperationLogsModule,
    BianbianAdminModule,
  ],
})
export class AppModule {}
