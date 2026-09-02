import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployModuleStageCommandEntity } from '../entities/deploy-module-stage-command.entity';
import { StageCommandService } from './stage-command.service';
import { StageCommandController } from './stage-command.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DeployModuleStageCommandEntity])],
  controllers: [StageCommandController],
  providers: [StageCommandService],
  exports: [StageCommandService],
})
export class StageCommandModule {}
