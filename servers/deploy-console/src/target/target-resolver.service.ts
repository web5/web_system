import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployServiceEntity } from '../entities/deploy-service.entity';

/**
 * 跨域目标解析（双域重构 P0）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §2 / tech-design.md §2.6
 * - 统一寻址串：`app:<key>` / `svc:<key>`
 * - **历史值兜底（FR-9.2）**：流水线表里的 `moduleKey` 无前缀（如 `admin`），
 *   按「先 apps 后 services」解析 → **历史流水线数据零改造**
 * - 提供 `rootDir`（apps/servers）与 `repoDir`，供执行器推导构建目录（替代 `type === 'backend'` 判断）
 */
export type TargetDomain = 'app' | 'svc';

export interface ResolvedTarget {
  /** 归一化引用：app:admin / svc:auth-service */
  ref: string;
  domain: TargetDomain;
  /** 应用 key 或服务 key */
  key: string;
  /** 应用 kind（shell/micro-frontend/...）或服务 kind（nest/mcp/...） */
  kind: string;
  /** 完整仓库相对目录：apps/<dir> 或 servers/<dir> */
  repoDir: string;
  /** 仓库根目录名 */
  rootDir: 'apps' | 'servers';
  /** 仅应用有：部署模式（site-version = 基座，不走 envId 目录） */
  deployMode?: 'env-dir' | 'site-version';
}

@Injectable()
export class TargetResolver {
  private readonly logger = new Logger(TargetResolver.name);

  constructor(
    @InjectRepository(DeployAppEntity)
    private readonly appRepo: Repository<DeployAppEntity>,
    @InjectRepository(DeployServiceEntity)
    private readonly serviceRepo: Repository<DeployServiceEntity>,
  ) {}

  /**
   * 解析目标（支持带前缀的 targetRef 与历史无前缀 key）
   */
  async resolve(refOrKey: string): Promise<ResolvedTarget> {
    const raw = String(refOrKey ?? '').trim();
    if (!raw) throw new Error('发布目标为空');

    if (raw.startsWith('app:')) return this.resolveApp(raw.slice(4));
    if (raw.startsWith('svc:')) return this.resolveService(raw.slice(4));

    // 历史值（无前缀）：先 apps 后 services
    const app = await this.appRepo.findOne({ where: { key: raw } });
    if (app) {
      this.logger.debug(`历史 key 解析为应用：${raw} → app:${raw}`);
      return this.toApp(app);
    }
    const svc = await this.serviceRepo.findOne({ where: { key: raw } });
    if (svc) {
      this.logger.debug(`历史 key 解析为服务：${raw} → svc:${raw}`);
      return this.toService(svc);
    }
    throw new Error(`未找到发布目标：${raw}（既不是应用也不是服务）`);
  }

  /** 批量解析（列表页用），未找到的返回 null 而不抛错 */
  async resolveMany(keys: string[]): Promise<(ResolvedTarget | null)[]> {
    return Promise.all(
      keys.map((k) => this.resolve(k).catch(() => null)),
    );
  }

  private async resolveApp(key: string): Promise<ResolvedTarget> {
    const app = await this.appRepo.findOne({ where: { key } });
    if (!app) throw new Error(`未找到应用：${key}`);
    return this.toApp(app);
  }

  private async resolveService(key: string): Promise<ResolvedTarget> {
    const svc = await this.serviceRepo.findOne({ where: { key } });
    if (!svc) throw new Error(`未找到服务：${key}`);
    return this.toService(svc);
  }

  private toApp(app: DeployAppEntity): ResolvedTarget {
    return {
      ref: `app:${app.key}`,
      domain: 'app',
      key: app.key,
      kind: app.kind,
      repoDir: app.repoDir,
      rootDir: 'apps',
      deployMode: app.deployMode,
    };
  }

  private toService(svc: DeployServiceEntity): ResolvedTarget {
    return {
      ref: `svc:${svc.key}`,
      domain: 'svc',
      key: svc.key,
      kind: svc.kind,
      repoDir: svc.repoDir,
      rootDir: 'servers',
    };
  }
}
