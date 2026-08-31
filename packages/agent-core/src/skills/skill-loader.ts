/**
 * 技能加载器（on-demand 挂载核心）
 *
 * 运行时不注入技能全文，只注入「技能目录」（code + description 摘要），
 * 模型判断需要时通过内置 load_skill 工具拉取全文。
 *
 * SkillProvider 由服务层（ai-agent）实现：load(code) 从 ai-service
 * /internal/skills/:code 拉取 SKILL.md 全文（带缓存）。
 * 目录（toCatalog）按当前 Agent 的 skills 动态生成，不做全局状态。
 */
import { Skill, SkillRef } from '../interfaces/agent.interface';

export interface SkillProvider {
  /** 按 code 加载技能全文（不存在返回 null） */
  load(code: string): Promise<Skill | null>;
}

export class SkillLoader {
  constructor(private readonly provider: SkillProvider) {}

  async load(code: string): Promise<Skill | null> {
    return this.provider.load(code);
  }

  /**
   * 生成注入 system prompt 的技能目录文本（按当前 Agent 的 skills）。
   * 无技能时返回空串（不污染 system）。
   */
  toCatalog(skills: SkillRef[] | undefined | null): string {
    const list = (skills || []).filter((s) => s.enabled !== false);
    if (!list.length) return '';
    const lines = list.map((s) => `- ${s.code}：${s.description}`);
    return (
      `\n[已挂载技能]\n${lines.join('\n')}\n` +
      '当用户需求命中上述技能范围时，先调用 load_skill 工具（参数 code）加载该技能的完整规范，再按规范执行。'
    );
  }
}
