import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InternalGuard } from '../api-key/internal.guard';
import { User } from '../user/user.entity';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), ConfigModule],
  controllers: [IdentityController],
  providers: [IdentityService, InternalGuard],
  exports: [IdentityService],
})
export class IdentityModule {}
