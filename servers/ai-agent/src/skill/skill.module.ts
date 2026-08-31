import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentSkillProvider } from './agent-skill-provider';

@Module({
  imports: [ConfigModule],
  providers: [AgentSkillProvider],
  exports: [AgentSkillProvider],
})
export class SkillModule {}
