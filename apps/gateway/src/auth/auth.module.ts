import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET', 'your-secret-key-change-in-production'),
        signOptions: { expiresIn: configService.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  providers: [AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
