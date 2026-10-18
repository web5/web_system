import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AgentDefService } from './agent-def.service';
import { AgentDefinitionEntity } from './entities/agent-definition.entity';
import { AgentDefinitionVersionEntity } from './entities/agent-definition-version.entity';
import { SkillService } from '../skill/skill.service';

describe('AgentDefService.seed', () => {
  it('缺失定义使用 prod 注册键，重复 seed 保留已有定义与版本', async () => {
    const existing = { id: 'general', model: 'custom-model' };
    const rows = new Map<string, { id: string; model: string }>([['general', existing]]);
    const findOne = jest.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id));
    const saveDefinition = jest.fn(async (row: { id: string; model: string }) => {
      rows.set(row.id, row);
      return row;
    });
    const saveVersion = jest.fn(async (row) => row);
    const definitions = {
      findOne,
      create: (row: unknown) => row,
      save: saveDefinition,
    } as unknown as Repository<AgentDefinitionEntity>;
    const versions = {
      create: (row: unknown) => row,
      save: saveVersion,
    } as unknown as Repository<AgentDefinitionVersionEntity>;
    const service = new AgentDefService(
      definitions,
      versions,
      {} as SkillService,
      new ConfigService(),
    );

    await service.seed();

    for (const agentId of ['deploy', 'web-system-dev']) {
      expect(rows.get(agentId)?.model).toBe('deepseek-v4-flash');
      expect(saveVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId,
          model: 'deepseek-v4-flash',
        }),
      );
    }
    expect(rows.get('general')).toBe(existing);
    const savedCount = saveDefinition.mock.calls.length;
    await expect(service.seed()).resolves.toEqual({ seeded: 0 });
    expect(saveDefinition).toHaveBeenCalledTimes(savedCount);
    expect(saveVersion).toHaveBeenCalledTimes(savedCount);

    rows.delete('general');
    await expect(service.seed()).resolves.toEqual({ seeded: 1 });
    expect(rows.get('general')?.model).toBe('deepseek-v4-flash');
    expect(saveVersion).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentId: 'general',
        model: 'deepseek-v4-flash',
      }),
    );
  });
});
