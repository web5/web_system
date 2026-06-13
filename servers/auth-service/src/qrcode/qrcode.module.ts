import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { QrcodeController } from './qrcode.controller';
import { QrcodeService } from './qrcode.service';
import { QrcodeStore } from './qrcode.store';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    UserModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET', 'your-secret-key'),
        signOptions: { expiresIn: configService.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  controllers: [QrcodeController],
  providers: [QrcodeService, QrcodeStore],
})
export class QrcodeModule {}
