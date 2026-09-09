import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from './auth.guard';
import { InternalKeyGuard } from './internal-key.guard';

@Module({
  imports: [ConfigModule],
  providers: [AuthGuard, InternalKeyGuard],
  exports: [AuthGuard, InternalKeyGuard],
})
export class AuthModule {}
