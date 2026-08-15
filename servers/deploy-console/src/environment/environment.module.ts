import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployEnvironmentEntity } from '../entities/deploy-environment.entity';
import { EnvironmentService } from './environment.service';
import { EnvironmentController } from './environment.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DeployEnvironmentEntity])],
  controllers: [EnvironmentController],
  providers: [EnvironmentService],
  exports: [EnvironmentService],
})
export class EnvironmentModule {}
