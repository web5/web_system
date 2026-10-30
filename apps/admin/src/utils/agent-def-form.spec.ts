/**
 * Agent 定义表单映射单测（agent-def-form.ts）—— B3 形态修正：详情页表单加载口径。
 *
 * 覆盖：D10（temperature 空值不 ?? 0.7 预填）、thinking 三态映射、
 * 联动①（带工具默认 enabled）、capabilities 从 tools 派生（老数据兼容）。
 * 真源：docs/ui/page-specs/agent-def-detail-v2.md + docs/api/contracts.md §7 C7-c/C7-e。
 */
import { defaultAgentForm, defToForm, deriveThinkingForm } from './agent-def-form';
import type { AgentDef } from '@/api/agent-defs';

const baseDef: AgentDef = {
  id: 'dev-assist',
  name: '研发助手',
  description: null,
  keywords: null,
  systemPrompt: 'You are helpful.',
  model: 'hy3',
  tools: [],
  capabilities: null,
  skills: null,
  maxSteps: 10,
  temperature: null,
  maxTokens: null,
  topP: null,
  thinking: null,
  memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
  streaming: true,
  version: 1,
  status: 'draft',
  enabled: true,
  publishedAt: null,
  updatedBy: null,
  createdAt: '2026-10-28T10:00:00Z',
  updatedAt: '2026-10-28T10:00:00Z',
};

describe('defaultAgentForm：新建默认值（C7-e 空值语义）', () => {
  it('temperature / maxTokens / topP / thinking 全部为「未配置」，不预填 0.7', () => {
    const f = defaultAgentForm();
    expect(f.temperature).toBeNull();
    expect(f.maxTokens).toBeNull();
    expect(f.topP).toBeNull();
    expect(f.thinking).toBeNull();
    expect(f.maxSteps).toBe(10);
  });
});

describe('defToForm：详情页载入映射（D10 修正）', () => {
  it('temperature 为 null 时保持 null（禁止 ?? 0.7 预填）', () => {
    const { form } = defToForm({ ...baseDef, temperature: null });
    expect(form.temperature).toBeNull();
  });

  it('temperature 有值时原样载入', () => {
    const { form } = defToForm({ ...baseDef, temperature: 0.3 });
    expect(form.temperature).toBe(0.3);
  });

  it('maxTokens / topP / thinking 空值映射为未配置（null）', () => {
    const { form, thinking } = defToForm(baseDef);
    expect(form.maxTokens).toBeNull();
    expect(form.topP).toBeNull();
    expect(form.thinking).toBeNull();
    expect(thinking).toBe('null');
  });

  it('thinking enabled/disabled 映射为表单三态', () => {
    const t1 = defToForm({ ...baseDef, thinking: { type: 'enabled' } });
    expect(t1.thinking).toBe('enabled');
    const t2 = defToForm({ ...baseDef, thinking: { type: 'disabled' } });
    expect(t2.thinking).toBe('disabled');
  });

  it('capabilities 为空时从 tools 派生（老数据兼容）', () => {
    const { form } = defToForm({ ...baseDef, tools: ['web-search'] });
    expect(form.capabilities).toEqual([{ type: 'tool', ref: 'web-search', enabled: true }]);
  });

  it('capabilities 已有值时保留副本（不共享引用）', () => {
    const caps = [{ type: 'tool' as const, ref: 'x', enabled: true }];
    const { form } = defToForm({ ...baseDef, tools: [], capabilities: caps });
    expect(form.capabilities).toEqual(caps);
    expect(form.capabilities![0]).not.toBe(caps[0]);
  });

  it('keywords 为 null 时映射为空数组', () => {
    const { form, keywordsInput } = defToForm(baseDef);
    expect(form.keywords).toEqual([]);
    expect(keywordsInput).toEqual([]);
    const r = defToForm({ ...baseDef, keywords: ['画画', '生图'] });
    expect(r.keywordsInput).toEqual(['画画', '生图']);
  });
});

describe('deriveThinkingForm：联动①（带工具默认 enabled，W1 配置默认侧）', () => {
  it('带工具 + 未配置 → 默认 enabled', () => {
    expect(deriveThinkingForm(true, null)).toBe('enabled');
    expect(deriveThinkingForm(true, undefined)).toBe('enabled');
  });
  it('带工具 + 显式值 → 尊重显式值（disabled 走误配警示，不纠正）', () => {
    expect(deriveThinkingForm(true, { type: 'disabled' })).toBe('disabled');
    expect(deriveThinkingForm(true, { type: 'enabled' })).toBe('enabled');
  });
  it('非工具 + 未配置 → 保持未配置（NULL）', () => {
    expect(deriveThinkingForm(false, null)).toBe('null');
  });
  it('非工具 + 显式值 → 尊重显式值', () => {
    expect(deriveThinkingForm(false, { type: 'disabled' })).toBe('disabled');
    expect(deriveThinkingForm(false, { type: 'enabled' })).toBe('enabled');
  });
});
