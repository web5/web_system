/**
 * capability-resolver 单元测试（Phase1.1：让引擎直接消费 capabilities，不再只看 tools/skills 旧字段）
 *
 * 验收锚点（specs/agent-platform-evolution/requirements.md R1.1）：
 * - 声明 capabilities 的 agent，其 tool / mcp / skill 能力应按声明全部解析出来
 * - capabilities 中禁用（enabled=false）的能力不得生效
 * - 不声明 capabilities 的 agent 行为与旧字段（tools / skills）完全一致（向后兼容）
 */
import { resolveAgentCapabilities } from './capability-resolver';
import { AgentDefinition } from '../interfaces/agent.interface';

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: 'a',
    name: '测试',
    systemPrompt: 'prompt',
    model: 'hy3',
    tools: [],
    maxSteps: 5,
    memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
    ...overrides,
  };
}

describe('resolveAgentCapabilities', () => {
  it('未声明 capabilities 时，回退到旧字段 tools/skills（向后兼容）', () => {
    const agent = makeAgent({ tools: ['calc', 'web_search'], skills: [{ code: 's1', name: '技能一', description: 'd' }] });
    const r = resolveAgentCapabilities(agent);
    expect(r.tools).toEqual(['calc', 'web_search']);
    expect(r.skills.map((s) => s.code)).toEqual(['s1']);
  });

  it('capabilities 声明 tool/mcp/skill 三类且无旧字段时，全部解析；mcp ref 取短名', () => {
    const agent = makeAgent({
      capabilities: [
        { type: 'tool', ref: 'contract_rule', enabled: true },
        { type: 'mcp', ref: 'deploy/publish_pipeline', enabled: true },
        { type: 'mcp', ref: 'deploy/get_job_status', enabled: true },
        { type: 'skill', ref: 'web-system-finnews', enabled: true },
      ],
    });
    const r = resolveAgentCapabilities(agent);
    expect(r.tools).toEqual(['contract_rule', 'publish_pipeline', 'get_job_status']);
    expect(r.skills.map((s) => s.code)).toEqual(['web-system-finnews']);
    expect(r.skills[0].name).toBe('web-system-finnews'); // 无 agent.skills 摘要时以 code 兜底
  });

  it('mcp ref 无斜杠（本身就是短名）时原样保留', () => {
    const agent = makeAgent({ capabilities: [{ type: 'mcp', ref: 'publish_pipeline', enabled: true }] });
    expect(resolveAgentCapabilities(agent).tools).toEqual(['publish_pipeline']);
  });

  it('enabled=false 的 tool / mcp / skill 均不生效', () => {
    const agent = makeAgent({
      capabilities: [
        { type: 'tool', ref: 'keep', enabled: true },
        { type: 'tool', ref: 'drop', enabled: false },
        { type: 'mcp', ref: 'm/drop_tool', enabled: false },
        { type: 'skill', ref: 'drop-skill', enabled: false },
        { type: 'skill', ref: 'keep-skill', enabled: true },
      ],
      skills: [{ code: 'drop-skill', name: '禁用技能', description: 'd' }],
    });
    const r = resolveAgentCapabilities(agent);
    expect(r.tools).toEqual(['keep']);
    expect(r.skills.map((s) => s.code)).toEqual(['keep-skill']);
  });

  it('capabilities 中的 skill 与 agent.skills 同名时，采用 agent.skills 完整摘要', () => {
    const agent = makeAgent({
      skills: [{ code: 'finnews', name: '财经快讯', description: '摘要', requiredTools: ['web_search'] }],
      capabilities: [{ type: 'skill', ref: 'finnews', enabled: true }],
    });
    const r = resolveAgentCapabilities(agent);
    expect(r.skills).toHaveLength(1);
    expect(r.skills[0].name).toBe('财经快讯');
    expect(r.skills[0].description).toBe('摘要');
  });

  it('agent.skills 中未被 capabilities 声明且未禁用的技能仍进入目录（合并而非互斥）', () => {
    const agent = makeAgent({
      skills: [
        { code: 'extra', name: '额外技能', description: 'd' },
      ],
      capabilities: [{ type: 'skill', ref: 'extra', enabled: true }],
    });
    const r = resolveAgentCapabilities(agent);
    expect(r.skills.map((s) => s.code)).toEqual(['extra']);
  });

  it('重复的工具名去重（capabilities 重复声明同一 ref 只保留一次）', () => {
    const agent = makeAgent({
      capabilities: [
        { type: 'tool', ref: 'calc', enabled: true },
        { type: 'tool', ref: 'calc', enabled: true },
        { type: 'mcp', ref: 'm1/dup', enabled: true },
        { type: 'mcp', ref: 'm2/dup', enabled: true },
      ],
    });
    const r = resolveAgentCapabilities(agent);
    expect(r.tools).toEqual(['calc', 'dup']);
  });
});
