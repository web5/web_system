import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployCanaryRuleEntity } from '../entities/deploy-canary-rule.entity';
import { CanaryService } from './canary.service';
import { CanaryController } from './canary.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeployCanaryRuleEntity]), AuditModule],
  providers: [CanaryService],
  controllers: [CanaryController],
  exports: [CanaryService],
})
export class CanaryModule {}
