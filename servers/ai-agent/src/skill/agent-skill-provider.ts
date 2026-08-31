import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Skill, SkillProvider } from '@kedouai/agent-core';

/**
 * ai-agent 侧技能数据源：从 ai-service /internal/skills/:code 拉取技能全文。
 * 带 60s 内存缓存（技能正文是静态资产，无需高频拉取）。
 */
@Injectable()
export class AgentSkillProvider implements SkillProvider {
  private readonly logger = new Logger(AgentSkillProvider.name);
  private readonly endpoint: string;
  private readonly cache = new Map<string, { at: number; skill: Skill | null }>();
  private static readonly TTL_MS = 60_000;

  constructor(configService: ConfigService) {
    const base = configService.get<string>('AI_SERVICE_URL', 'http://localhost:6003');
    this.endpoint = `${base.replace(/\/+$/, '')}/internal/skills`;
  }

  async load(code: string): Promise<Skill | null> {
    const cached = this.cache.get(code);
    if (cached && Date.now() - cached.at < AgentSkillProvider.TTL_MS) {
      return cached.skill;
    }

    try {
      const res = await fetch(`${this.endpoint}/${encodeURIComponent(code)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.cache.set(code, { at: Date.now(), skill: null });
        return null;
      }
      const json = (await res.json()) as {
        data?: Record<string, unknown>;
      } & Record<string, unknown>;
      const raw = (json?.data ?? json) as Record<string, unknown>;
      if (!raw?.content) {
        this.cache.set(code, { at: Date.now(), skill: null });
        return null;
      }
      const skill: Skill = {
        code: String(raw.code ?? code),
        name: String(raw.name ?? code),
        description: String(raw.description ?? ''),
        version: String(raw.version ?? '1.0.0'),
        content: String(raw.content),
        requiredTools: Array.isArray(raw.requiredTools)
          ? (raw.requiredTools as string[])
          : undefined,
        enabled: raw.enabled !== false,
      };
      this.cache.set(code, { at: Date.now(), skill });
      return skill;
    } catch (err) {
      this.logger.warn(`拉取技能 ${code} 失败: ${(err as Error).message}`);
      this.cache.set(code, { at: Date.now(), skill: null });
      return null;
    }
  }
}
