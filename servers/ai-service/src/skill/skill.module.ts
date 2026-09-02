import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentSkillEntity } from './entities/agent-skill.entity';
import { SkillService } from './skill.service';
import { SkillController } from './skill.controller';
import { SkillInternalController } from './skill.internal.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AgentSkillEntity])],
  controllers: [SkillController, SkillInternalController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
