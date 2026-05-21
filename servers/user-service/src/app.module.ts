import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from './user/user.module';
import { User } from './user/user.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'web_system'),
        password: configService.get('DB_PASSWORD', 'web_system123'),
        database: configService.get('DB_DATABASE', 'web_system'),
        entities: [User],
        synchronize: true,
        logging: configService.get('NODE_ENV') === 'development',
      }),
    }),
    UserModule,
  ],
})
export class AppModule {}
