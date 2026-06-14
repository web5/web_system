import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ProxyModule } from './proxy/proxy.module';
import { AuthModule } from './auth/auth.module';
import { StaticModule } from './static/static.module';
import { HealthModule } from './health/health.module';
import { SwaggerDocsModule } from './swagger-docs/swagger-docs.module';
import { ApiDocsModule } from './api-docs/api-docs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    HealthModule,
    ProxyModule,
    AuthModule,
    StaticModule,
    SwaggerDocsModule,
    ApiDocsModule,
  ],
})
export class AppModule {}
