import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployReleaseLockEntity } from '../entities/deploy-release-lock.entity';
import { ReleaseLockService } from './release-lock.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeployReleaseLockEntity])],
  providers: [ReleaseLockService],
  exports: [ReleaseLockService],
})
export class ReleaseLockModule {}
