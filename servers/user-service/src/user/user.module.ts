import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { OperationLogClient } from '../permission/operation-log.client';
import { PublicBaseUrlService } from '@web-system/shared';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UserController],
  providers: [UserService, OperationLogClient, PublicBaseUrlService],
  exports: [UserService],
})
export class UserModule {}
