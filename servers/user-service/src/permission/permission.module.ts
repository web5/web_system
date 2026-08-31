import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { User } from '@web-system/shared';
import { PermissionEntity } from './entities/permission.entity';
import { RoleEntity } from './entities/role.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';
import { InternalPermissionController } from './internal.controller';
import { InternalGuard } from '../api-key/internal.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([PermissionEntity, RoleEntity, RolePermissionEntity, User]),
    ConfigModule,
  ],
  controllers: [PermissionController, InternalPermissionController],
  providers: [PermissionService, InternalGuard],
  exports: [PermissionService],
})
export class PermissionModule {}
