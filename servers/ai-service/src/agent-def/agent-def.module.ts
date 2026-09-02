import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentDefinitionEntity } from './entities/agent-definition.entity';
import { AgentDefinitionVersionEntity } from './entities/agent-definition-version.entity';
import { AgentDefService } from './agent-def.service';
import { AgentDefController } from './agent-def.controller';
import { AgentDefInternalController } from './agent-def.internal.controller';
import { AuthModule } from '../auth/auth.module';
import { SkillModule } from '../skill/skill.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentDefinitionEntity, AgentDefinitionVersionEntity]),
    AuthModule,
    SkillModule,
  ],
  providers: [AgentDefService],
  controllers: [AgentDefController, AgentDefInternalController],
  exports: [AgentDefService, TypeOrmModule],
})
export class AgentDefModule implements OnModuleInit {
  private readonly logger = new Logger(AgentDefModule.name);

  constructor(private readonly defs: AgentDefService) {}

  async onModuleInit() {
    // 首次启动 seed 内置 agent 定义（仅空表时执行一次）
    const { seeded } = await this.defs.seed();
    if (seeded > 0) {
      this.logger.log(`Agent 定义 seed 完成：${seeded} 个`);
    }
  }
}
