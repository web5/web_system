import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployToolEntity } from '../entities/deploy-tool-catalog.entity';

export interface ToolSpec {
  name: string;
  kind?: 'service' | 'shell';
  category?: string;
  description?: string;
  example?: string;
  available?: boolean;
}

/** 种子工具（service = 内置执行器，code 与 executeStage 步骤对应；shell = 外部 CLI） */
export const SEED_TOOLS: Array<Partial<DeployToolEntity>> = [
  // service 内置执行器（平台语义）
  { code: 'check', name: '安全校验（类型/分支/prod）', kind: 'service', category: 'semantic', description: '模块类型/目标分支/环境约束校验；发布语义基线，不可裁剪', builtin: true },
  { code: 'pull', name: '拉取代码', kind: 'service', category: 'code', description: '发布目录 git fetch + checkout 目标分支/commit + 依赖同步', builtin: true },
  { code: 'build', name: '构建产物', kind: 'service', category: 'build', description: '由模块 build 阶段命令驱动（fail-fast，未配置即终止）', builtin: true },
  { code: 'upload', name: '前端产物投递', kind: 'service', category: 'deploy', description: '前端/微前端 dist 投递到静态目录（scp/rsync）', builtin: true },
  { code: 'restart', name: '后端进程重启', kind: 'service', category: 'deploy', description: 'pm2 restart + 配置注入重建进程', builtin: true },
  { code: 'version', name: '写版本记录', kind: 'service', category: 'semantic', description: '版本表登记；发布语义真相源，不可裁剪/覆盖', builtin: true },
  { code: 'pointer', name: '切换版本指针/灰度规则', kind: 'service', category: 'semantic', description: '前端 stable 指针或灰度规则写入', builtin: true },
  { code: 'verify', name: '探活验证', kind: 'service', category: 'probe', description: '前端 manifest / 后端 health 真实探活；失败自动回滚（模板可裁剪）', builtin: true },
  { code: 'cleanup', name: '清理旧版本', kind: 'service', category: 'cleanup', description: '保留最近 N 版，跳过被灰度引用的版本', builtin: true },
  { code: 'rollback', name: '回滚（上一版本）', kind: 'service', category: 'rollback', description: 'verify 失败自动回滚到上一稳定版本（rollbackOnFailure 开关）', builtin: true },
  // shell 工具（外部 CLI）
  { code: 'git', name: 'Git', kind: 'shell', category: 'code', example: 'git fetch --all --prune', builtin: true },
  { code: 'pnpm', name: 'pnpm', kind: 'shell', category: 'build', example: 'pnpm install --prefer-offline', builtin: true },
  { code: 'npm', name: 'npm', kind: 'shell', category: 'build', example: 'npm ci', builtin: true },
  { code: 'npx', name: 'npx', kind: 'shell', category: 'build', example: 'npx tsc -p tsconfig.json', builtin: true },
  { code: 'bash', name: 'bash', kind: 'shell', category: 'generic', example: 'bash -n script.sh', builtin: true },
  { code: 'scp', name: 'scp', kind: 'shell', category: 'deploy', example: 'scp -r dist user@host:/path', builtin: true },
  { code: 'rsync', name: 'rsync', kind: 'shell', category: 'deploy', example: 'rsync -az --delete dist/ user@host:/path', builtin: true },
  { code: 'tar', name: 'tar', kind: 'shell', category: 'deploy', example: 'tar -czf pkg.tgz -C dist .', builtin: true },
  { code: 'pm2', name: 'pm2', kind: 'shell', category: 'deploy', example: 'pm2 restart <name>', builtin: true },
  { code: 'curl', name: 'curl', kind: 'shell', category: 'probe', example: 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:PORT/', builtin: true },
];

const CATEGORIES = ['code', 'build', 'deploy', 'probe', 'rollback', 'cleanup', 'semantic', 'generic'];

@Injectable()
export class ToolCatalogService {
  constructor(
    @InjectRepository(DeployToolEntity)
    private readonly repo: Repository<DeployToolEntity>,
  ) {}

  /** 幂等补齐种子（启动/列表时确保内置工具存在） */
  async ensureSeeds(): Promise<void> {
    for (const seed of SEED_TOOLS) {
      const exists = await this.repo.findOne({ where: { code: seed.code as string } });
      if (exists) continue;
      try {
        await this.repo.save(this.repo.create(seed as DeployToolEntity));
      } catch {
        /* 并发首建撞主键忽略 */
      }
    }
  }

  async list(category?: string, kind?: string): Promise<DeployToolEntity[]> {
    await this.ensureSeeds();
    const where: Record<string, string> = {};
    if (category) where.category = category;
    if (kind) where.kind = kind;
    return this.repo.find({ where, order: { kind: 'DESC', category: 'ASC', code: 'ASC' } });
  }

  async get(code: string): Promise<DeployToolEntity> {
    const row = await this.repo.findOne({ where: { code } });
    if (!row) throw new NotFoundException(`工具不存在: ${code}`);
    return row;
  }

  async create(spec: ToolSpec): Promise<DeployToolEntity> {
    const code = spec.name?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || '';
    if (!code) throw new BadRequestException('工具名必填');
    const dup = await this.repo.findOne({ where: { code } });
    if (dup) throw new ConflictException(`工具 code 已存在: ${code}`);
    if (spec.category && !CATEGORIES.includes(spec.category)) {
      throw new BadRequestException(`分类仅支持 ${CATEGORIES.join('/')}`);
    }
    const row = this.repo.create({
      code,
      name: spec.name.trim(),
      kind: spec.kind ?? 'shell',
      category: spec.category ?? 'generic',
      description: spec.description?.trim() || undefined,
      example: spec.example?.trim() || undefined,
      available: spec.available ?? true,
      builtin: false,
    });
    return this.repo.save(row);
  }

  async update(code: string, patch: Partial<Omit<ToolSpec, 'name'>>): Promise<DeployToolEntity> {
    const row = await this.get(code);
    if (patch.description !== undefined) row.description = patch.description?.trim() || undefined;
    if (patch.example !== undefined) row.example = patch.example?.trim() || undefined;
    if (patch.available !== undefined) row.available = patch.available;
    if (patch.category !== undefined) {
      if (!CATEGORIES.includes(patch.category)) {
        throw new BadRequestException(`分类仅支持 ${CATEGORIES.join('/')}`);
      }
      row.category = patch.category;
    }
    return this.repo.save(row);
  }

  async remove(code: string): Promise<void> {
    const row = await this.get(code);
    if (row.builtin) {
      throw new BadRequestException('内置工具不可删除（可停用）');
    }
    await this.repo.delete(code);
  }
}
