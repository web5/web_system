import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { EmailVerificationCodeEntity } from './entities/email-verification-code.entity';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { InternalEmailController } from './internal-email.controller';
import { MailService } from '../api-key/mail.service';
import { InternalGuard } from '../api-key/internal.guard';

@Module({
  imports: [TypeOrmModule.forFeature([EmailVerificationCodeEntity]), ConfigModule],
  controllers: [EmailController, InternalEmailController],
  providers: [EmailService, MailService, InternalGuard],
  exports: [EmailService],
})
export class EmailModule {}
