import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard } from './auth.guard';

@Module({
  imports: [ConfigModule],
  providers: [AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
