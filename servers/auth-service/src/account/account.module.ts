import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccountService } from './account.service';
import { AccountController } from './account.controller';
import { WechatMpService } from './wechat-mp.service';

@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [AccountService, WechatMpService],
  exports: [AccountService, WechatMpService],
})
export class AccountModule {}
