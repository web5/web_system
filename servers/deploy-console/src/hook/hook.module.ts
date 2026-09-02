import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployModuleHookEntity } from '../entities/deploy-module-hook.entity';
import { HookService } from './hook.service';
import { HookController } from './hook.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DeployModuleHookEntity])],
  controllers: [HookController],
  providers: [HookService],
  exports: [HookService],
})
export class HookModule {}
