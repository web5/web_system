/**
 * Agent 能力解析器（Phase1.1）。
 *
 * 把 AgentDefinition 的能力声明归一成引擎可直接消费的结构，解决"引擎只读
 * tools/skills 旧字段、capabilities 中 tool/mcp 不生效"的半成品问题。
 *
 * 规则（与装配层保持一致，避免双实现漂移）：
 * - 有 capabilities：type=tool 的 ref 即工具名；type=mcp 取 ref 短名
 *   （`deploy/publish_pipeline` → `publish_pipeline`，与服务端 MCP 懒注册名一致）；
 *   type=skill 进入 on-demand 技能目录（有 agent.skills 同名项则采用其完整摘要）。
 * - capabilities 显式 enabled=false：tool/mcp 不注入；skill 即使存在于
 *   agent.skills 也被禁用。
 * - 无 capabilities：向后兼容，原样回退 tools / skills 旧字段。
 */
import { AgentDefinition, CapabilityRef, SkillRef } from '../interfaces/agent.interface';

export interface ResolvedAgentCapabilities {
  /** 可直接喂给 ToolRegistry.toSchemas / execute 的工具名（tool=ref；mcp=ref 短名） */
  tools: string[];
  /** on-demand 技能摘要目录（capabilities.skill + agent.skills 合并，禁用项剔除） */
  skills: SkillRef[];
}

/** `mcp:module/tool` 的调用/注册名 = tool 短名（与服务端 MCP 装配层规则一致） */
function mcpToolName(ref: string): string {
  const last = ref.split('/').pop();
  return last || ref;
}

export function resolveAgentCapabilities(agent: AgentDefinition): ResolvedAgentCapabilities {
  const capabilities: CapabilityRef[] = agent.capabilities ?? [];
  if (capabilities.length === 0) {
    return { tools: [...(agent.tools ?? [])], skills: [...(agent.skills ?? [])] };
  }

  const tools: string[] = [];
  const enabledSkillCodes: string[] = [];
  const disabledSkillCodes = new Set<string>();

  for (const cap of capabilities) {
    const on = cap.enabled !== false;
    if (cap.type === 'tool') {
      if (on) tools.push(cap.ref);
    } else if (cap.type === 'mcp') {
      if (on) tools.push(mcpToolName(cap.ref));
    } else if (cap.type === 'skill') {
      if (on) enabledSkillCodes.push(cap.ref);
      else disabledSkillCodes.add(cap.ref);
    }
  }

  // 技能目录 = agent.skills（未被显式禁用）+ capabilities 中声明的 skill code
  const skillsByCode = new Map<string, SkillRef>();
  for (const s of agent.skills ?? []) {
    if (s.enabled === false || disabledSkillCodes.has(s.code)) continue;
    skillsByCode.set(s.code, s);
  }
  for (const code of enabledSkillCodes) {
    if (skillsByCode.has(code)) continue;
    // capabilities 只给 code：name/description 以 code 兜底，保证目录至少可识别
    skillsByCode.set(code, { code, name: code, description: '' });
  }

  return { tools: [...new Set(tools)], skills: [...skillsByCode.values()] };
}
