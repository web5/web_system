import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentSkillEntity } from './entities/agent-skill.entity';
import { AgentDefinitionEntity } from '../agent-def/entities/agent-definition.entity';
import { SkillService } from './skill.service';
import { SkillController } from './skill.controller';
import { SkillInternalController } from './skill.internal.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AgentSkillEntity, AgentDefinitionEntity])],
  controllers: [SkillController, SkillInternalController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
