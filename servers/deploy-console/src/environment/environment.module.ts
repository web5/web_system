import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployEnvironmentEntity } from '../entities/deploy-environment.entity';
import { DeployModuleEntity } from '../entities/deploy-module.entity';
import { EnvironmentService } from './environment.service';
import { EnvironmentController, ModuleEnvironmentController } from './environment.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeployEnvironmentEntity, DeployModuleEntity]), AuditModule],
  controllers: [ModuleEnvironmentController, EnvironmentController],
  providers: [EnvironmentService],
  exports: [EnvironmentService],
})
export class EnvironmentModule {}
