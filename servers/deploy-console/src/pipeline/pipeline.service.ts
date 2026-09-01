import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import { DeployPipelineEntity, PIPELINE_STAGES, PipelineMode } from '../entities/deploy-pipeline.entity';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { CanaryService } from '../canary/canary.service';
import { AuditService } from '../audit/audit.service';
import { HookService } from '../hook/hook.service';
import { DeployService } from '../deploy/deploy.service';

/** 保留的历史版本目录数量（用户约定 N=5） */
const KEEP_VERSIONS = 5;
/** gateway 版本缓存 TTL（秒）—— 验证阶段必须等它过期后再断言 */
const GATEWAY_VERSION_TTL_SEC = 10;
/** 构建超时（毫秒） */
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 支持发布的环境。
 *
 * `local` = 本机环境（gateway 以 DEPLOY_ENV_ID=local 启动，读独立的一套版本指针）。
 * 它存在的意义：本地开发发布只投递本机产物，**不污染远程 dev 的指针**——
 * 否则远程 dev 的 gateway 会指向一个本地才有、远程没有的产物版本，导致 dev 页面 404。
 */
export const SUPPORTED_ENVS: readonly string[] = ['local', 'dev', 'staging', 'prod'];

export interface SubmitPipelineDto {
  env: string;
  moduleKey: string;
  /** direct=全量；grayscale=灰度（写灰度规则，不切 stable 指针） */
  mode?: PipelineMode;
  /**
   * 目标分支（默认 master）。发布基于远程仓库的该分支拉取代码，而非当前工作区。
   */
  branch?: string;
  /**
   * 目标 commitId（git 短哈希）。不传则取该分支最新提交。
   * 兼容旧参数名 versionTag。
   */
  commitId?: string;
  /** @deprecated 等价于 commitId，兼容旧调用 */
  versionTag?: string;
  /** 投递目标：local=本机静态目录；remote=SSH 到服务器。默认自动判定 */
  target?: 'local' | 'remote';
  /** 灰度规则（mode=grayscale 时必填）：{ type:'percent'|'user-list'|'header', ... } */
  grayscaleRule?: Record<string, unknown>;
}

/**
 * 发布流水线引擎。
 *
 * 把「构建 → 投递产物 → 写版本表 → 切指针 → 等 TTL 并验证 → 清理旧版本」固化为一条流水线，
 * 其中「版本表必须是 web_system_deploy 库」「必须等 gateway TTL 再断言」两个历史坑由代码保证。
 *
 * 任务状态落库（deploy_pipelines），可查询/可取消；执行为后台异步，不阻塞提交请求。
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  /** 取消标记（进程内即可，重启后任务本身也会中断） */
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(DeployPipelineEntity)
    private readonly pipelineRepo: Repository<DeployPipelineEntity>,
    @InjectRepository(DeployVersionEntity)
    private readonly versionRepo: Repository<DeployVersionEntity>,
    @InjectRepository(DeployDeploymentEntity)
    private readonly deploymentRepo: Repository<DeployDeploymentEntity>,
    private readonly moduleRegistry: ModuleRegistryService,
    private readonly canaryService: CanaryService,
    private readonly auditService: AuditService,
    private readonly hookService: HookService,
    private readonly deployService: DeployService,
  ) {}

  /**
   * 发布目录（RELEASE_WORKSPACE）：
   * 从远程仓库拉取代码并构建部署的隔离目录，与开发工作区完全分离。
   * 本地验证流程 = 开发工作区 commit&push → 发布目录 fetch/checkout → 构建部署。
   */
  private get releaseWorkspace(): string {
    return (
      this.configService.get<string>('RELEASE_WORKSPACE') || '/Users/geekwen/web_system_release'
    );
  }

  /** node / npm / npx / pnpm 所在目录（发布目录构建用；可配 RELEASE_NODE_BIN 覆盖） */
  private get nodeBinDir(): string {
    return (
      this.configService.get<string>('RELEASE_NODE_BIN') || path.dirname(process.execPath)
    );
  }

  private get npxBin(): string {
    return path.join(this.nodeBinDir, 'npx');
  }

  private get pnpmBin(): string {
    return this.configService.get<string>('RELEASE_PNPM_BIN') || path.join(this.nodeBinDir, 'pnpm');
  }

  private get pm2Bin(): string {
    return this.configService.get<string>('RELEASE_PM2_BIN') || path.join(this.nodeBinDir, 'pm2');
  }

  /** gateway 内网地址，用于验证阶段查询 __manifest__（本地 http://localhost:6000） */
  private get gatewayUrl(): string {
    return this.configService.get<string>('GATEWAY_INTERNAL_URL') || 'http://localhost:6000';
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 提交发布流水线：落库后立即返回，后台异步执行。
   * 同一 (env, moduleKey) 不允许并发发布（避免产物互相覆盖）。
   */
  async submit(dto: SubmitPipelineDto, operator?: string): Promise<{ jobId: string; status: string }> {
    const mode: PipelineMode = dto.mode ?? 'direct';
    if (!SUPPORTED_ENVS.includes(dto.env)) {
      throw new BadRequestException(
        `不支持的环境: ${dto.env}（支持 ${SUPPORTED_ENVS.join(' / ')}）`,
      );
    }
    if (mode === 'grayscale' && !dto.grayscaleRule) {
      throw new BadRequestException('灰度发布必须提供 grayscaleRule');
    }

    const running = await this.pipelineRepo.findOne({
      where: { env: dto.env, moduleKey: dto.moduleKey, status: 'running' as any },
    });
    if (running) {
      throw new ConflictException(
        `模块 ${dto.moduleKey} 在 ${dto.env} 有正在运行的流水线 ${running.id}，请等待完成或取消`,
      );
    }

    const id = this.generateId();
    const entity = this.pipelineRepo.create({
      id,
      env: dto.env,
      moduleKey: dto.moduleKey,
      // commitId 与旧参数名 versionTag 等价
      versionTag: dto.commitId ?? dto.versionTag,
      gitBranch: dto.branch || undefined,
      mode,
      status: 'pending',
      stage: 'check',
      progress: { current: 0, total: PIPELINE_STAGES.length, message: '已提交，等待执行' },
      logs: [],
      operator,
      grayscaleRule: dto.grayscaleRule,
      startTime: Date.now(),
    });
    await this.pipelineRepo.save(entity);

    await this.auditService.log({
      user: operator || 'unknown',
      action: 'pipeline.submit',
      env: dto.env,
      component: dto.moduleKey,
      status: 'started',
      detail: `提交发布流水线 ${id}（mode=${mode}）`,
    });

    // 后台执行，不阻塞提交响应
    void this.run(entity, dto.target);

    return { jobId: id, status: entity.status };
  }

  /** 查询流水线状态 */
  async get(id: string): Promise<DeployPipelineEntity> {
    const p = await this.pipelineRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`流水线不存在: ${id}`);
    return p;
  }

  /** 列出流水线（按开始时间倒序） */
  async list(env?: string, moduleKey?: string, limit = 20): Promise<DeployPipelineEntity[]> {
    const where: Record<string, unknown> = {};
    if (env) where.env = env;
    if (moduleKey) where.moduleKey = moduleKey;
    return this.pipelineRepo.find({ where, order: { startTime: 'DESC' }, take: limit });
  }

  /** 取消流水线（幂等；仅对 pending/running 有意义） */
  async cancel(id: string, operator?: string): Promise<{ id: string; status: string }> {
    const p = await this.get(id);
    if (['succeeded', 'failed', 'cancelled'].includes(p.status)) {
      return { id, status: p.status };
    }
    this.cancelled.add(id);
    p.status = 'cancelled';
    p.endTime = Date.now();
    p.progress = { ...(p.progress ?? { current: 0, total: PIPELINE_STAGES.length }), message: '已取消' };
    await this.pipelineRepo.save(p);
    await this.auditService.log({
      user: operator || p.operator || 'unknown',
      action: 'pipeline.cancel',
      env: p.env,
      component: p.moduleKey,
      status: 'cancelled',
      detail: `取消流水线 ${id}（阶段: ${p.stage ?? '-'}）`,
    });
    return { id, status: p.status };
  }

  /**
   * 可发布版本（回滚/按版本发布的候选），按 versionTag 去重。
   *
   * 合并两个来源：
   *  - db：deploy_versions 记录（同一版本多次发布会有多条，按最新去重）
   *  - artifact：磁盘上已存在但未登记版本表的历史产物
   *
   * 控制台与 MCP 共用本方法，避免两边逻辑漂移。
   */
  async listReleaseCandidates(
    env?: string,
    component?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const where: Record<string, unknown> = {};
    if (env) where.env = env;
    if (component) where.component = component;

    const rows: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const v of await this.versionRepo.find({ where, order: { releasedAt: 'DESC' } })) {
      const tag = String(v.versionTag);
      if (seen.has(tag)) continue;
      seen.add(tag);
      rows.push({ ...v, source: 'db' });
    }

    if (component) {
      for (const tag of this.listArtifactVersions(component)) {
        if (seen.has(tag)) continue;
        seen.add(tag);
        rows.push({
          versionTag: tag,
          component,
          env: env || '',
          status: 'active',
          source: 'artifact',
          note: '磁盘产物（未登记版本表）',
        });
      }
    }
    return rows;
  }

  /** 发布目录产物目录中的版本列表（按修改时间倒序） */
  listArtifactVersions(moduleKey: string): string[] {
    const base = path.join(
      this.releaseWorkspace,
      'servers',
      'gateway',
      'public',
      'static',
      'modules',
      moduleKey,
    );
    if (!fs.existsSync(base)) return [];
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'index.js')))
      .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(base, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((d) => d.name);
  }

  /**
   * 仅切指针（不重新构建），用于回退到「版本表无记录」的历史版本。
   *
   * 背景：deploy.sh 时代写入的版本记录 component 形如 `mf:admin`，与现在的 `admin` 不一致，
   * 导致这些历史产物虽在磁盘上，却查不到版本记录、无法回滚。这里以**产物实际存在**为准，
   * 切换后补写一条版本记录（git 信息留空并标注来源）。
   */
  async switchPointer(
    env: string,
    moduleKey: string,
    versionTag: string,
    operator?: string,
  ): Promise<{ env: string; moduleKey: string; versionTag: string }> {
    const mod = await this.moduleRegistry.get(moduleKey);
    if (mod.type !== 'micro-frontend') {
      throw new BadRequestException(`模块 ${moduleKey} 类型为 ${mod.type}，仅支持微前端模块切换版本`);
    }
    const dir = path.join(
      this.releaseWorkspace,
      'servers',
      'gateway',
      'public',
      'static',
      'modules',
      moduleKey,
      versionTag,
    );
    if (!fs.existsSync(path.join(dir, 'index.js'))) {
      throw new BadRequestException(
        `版本产物不存在，无法切换: ${moduleKey}/${versionTag}（本地未找到 ${dir}/index.js）`,
      );
    }

    const existing = await this.deploymentRepo.findOne({ where: { envId: env, moduleKey } });
    const row = existing ?? new DeployDeploymentEntity();
    row.envId = env;
    row.moduleKey = moduleKey;
    row.currentVersion = versionTag;
    row.status = 'deployed';
    row.deployedAt = new Date();
    row.deployedBy = operator;
    await this.deploymentRepo.save(row);

    // 补写版本记录，保证后续 list_releases 能看到
    const v = new DeployVersionEntity();
    v.env = env;
    v.component = moduleKey;
    v.versionTag = versionTag;
    v.releasedBy = operator;
    v.releasedAt = new Date();
    v.status = 'active';
    v.note = '历史版本回退切换（原记录缺失，以产物为准）';
    await this.versionRepo.save(v);

    await this.auditService.log({
      user: operator || 'unknown',
      action: 'pipeline.switch_pointer',
      env,
      component: moduleKey,
      status: 'success',
      detail: `切换版本指针（历史版本回退）: ${env}/${moduleKey} → ${versionTag}`,
    });

    return { env, moduleKey, versionTag };
  }

  /**
   * 灰度转全量：把 stable 指针切到灰度版本，并禁用灰度规则。
   */
  async promote(id: string, operator?: string): Promise<{ id: string; versionTag: string }> {
    const p = await this.get(id);
    if (p.mode !== 'grayscale') {
      throw new BadRequestException(`流水线 ${id} 不是灰度发布，无需转全量`);
    }
    if (p.status !== 'succeeded') {
      throw new BadRequestException(`流水线 ${id} 未成功完成，无法转全量`);
    }
    if (!p.versionTag) {
      throw new BadRequestException(`流水线 ${id} 缺少版本标签`);
    }

    const existing = await this.deploymentRepo.findOne({
      where: { envId: p.env, moduleKey: p.moduleKey },
    });
    const row = existing ?? new DeployDeploymentEntity();
    row.envId = p.env;
    row.moduleKey = p.moduleKey;
    row.currentVersion = p.versionTag;
    row.status = 'deployed';
    row.deployedAt = new Date();
    row.deployedBy = operator ?? p.operator;
    row.taskId = p.id;
    await this.deploymentRepo.save(row);

    // 禁用本次灰度规则
    if (p.canaryRuleId) {
      try {
        await this.canaryService.update(p.canaryRuleId, { enabled: false });
      } catch (e) {
        this.logger.warn(`禁用灰度规则 ${p.canaryRuleId} 失败: ${(e as Error).message}`);
      }
    }

    await this.auditService.log({
      user: operator || p.operator || 'unknown',
      action: 'pipeline.promote',
      env: p.env,
      component: p.moduleKey,
      status: 'success',
      detail: `灰度转全量: ${p.env}/${p.moduleKey} → ${p.versionTag}`,
    });

    return { id, versionTag: p.versionTag };
  }

  // ── 执行引擎 ──────────────────────────────────────────────

  private async run(p: DeployPipelineEntity, target?: 'local' | 'remote'): Promise<void> {
    // local 环境只投递本机：远程投递到「本地环境」没有意义，且容易误改远程产物
    const uploadTarget =
      p.env === 'local' ? 'local' : (target ?? this.resolveDefaultTarget());
    if (target === 'remote' && p.env === 'local') {
      p.logs = [...(p.logs ?? []), 'local 环境不支持远程投递，已强制为本机投递'];
    }
    let prevVersion: string | undefined;

    try {
      p.status = 'running';
      await this.save(p);

      // 1. check：先内置安全校验（模块类型/prod 分支约束），再执行 check hook（附加校验）
      await this.stageCheck(p);
      if (await this.runHook(p, 'check')) {
      }

      const isBackend = p.moduleType === 'backend';

      if (p.reuseArtifact) {
        // 复用磁盘已有产物：跳过 pull/build/upload，直接切指针（秒级发布历史版本）
        p.logs = [...(p.logs ?? []), '已跳过 pull / build / upload（复用已有产物）'];
        await this.save(p);
      } else {
        // 2. pull：发布目录拉取远程仓库目标分支/commit（可被 hook 覆盖）
        if (!(await this.runHook(p, 'pull'))) await this.stagePull(p);
        // 3. build：前端 vite / 后端 nest（可被 hook 覆盖）
        if (!(await this.runHook(p, 'build'))) await this.stageBuild(p);
        // 4. upload（前端投递产物）/ restart（后端重启服务）（可被 hook 覆盖）
        if (isBackend) {
          if (!(await this.runHook(p, 'restart'))) await this.stageRestart(p);
        } else {
          if (!(await this.runHook(p, 'upload'))) await this.stageUpload(p, uploadTarget);
        }
      }
      // 5. version（写版本表）；回滚前先记录当前线上版本作为回退目标
      try {
        const dep = await this.deploymentRepo.findOne({
          where: { envId: p.env, moduleKey: p.moduleKey },
        });
        prevVersion = dep?.currentVersion;
      } catch {
        /* 查询失败不影响发布，仅导致失败时无法自动回滚 */
      }
      await this.stageVersion(p);
      // 6. pointer：前端切指针/灰度规则；后端无指针
      if (!isBackend) {
        await this.stagePointer(p);
      }
      // 7. verify：前端 manifest / 后端 health check（可被 hook 覆盖）
      if (!(await this.runHook(p, 'verify'))) await this.stageVerify(p);
      // 8. cleanup（可被 hook 覆盖）
      if (!(await this.runHook(p, 'cleanup'))) await this.stageCleanup(p);

      p.status = 'succeeded';
      p.progress = { ...p.progress!, message: '发布完成' };
      p.endTime = Date.now();
      await this.save(p);

      await this.auditService.log({
        user: p.operator || 'unknown',
        action: 'pipeline.finish',
        env: p.env,
        component: p.moduleKey,
        status: 'success',
        detail: `发布成功: ${p.env}/${p.moduleKey} → ${p.versionTag}（mode=${p.mode}, target=${uploadTarget}）`,
      });
      this.logger.log(`流水线完成: ${p.id} ${p.env}/${p.moduleKey} → ${p.versionTag}`);
    } catch (e) {
      const msg = (e as Error).message;
      p.status = 'cancelled' === p.status ? 'cancelled' : 'failed';
      if (p.status === 'failed') {
        p.error = msg;
        p.progress = { ...(p.progress ?? { current: 0, total: PIPELINE_STAGES.length }), message: `失败: ${msg}` };
        p.endTime = Date.now();
      }
      await this.save(p);
      this.logger.error(`流水线失败: ${p.id} 阶段=${p.stage} : ${msg}`);
      if (p.status === 'failed') {
        // ⑤ 验证阶段失败 → 自动回滚到上一稳定版本（verify 阶段才说明新版本已发布但不健康）
        if (p.stage === 'verify' && prevVersion && prevVersion !== p.versionTag) {
          try {
            const rollTask = await this.deployService.startRollback(
              p.env,
              prevVersion,
              p.operator,
              p.moduleKey,
            );
            p.logs = [...(p.logs ?? []), `验证失败，已自动回滚到 ${prevVersion}（task=${rollTask}）`];
            await this.auditService.log({
              user: p.operator || 'unknown',
              action: 'pipeline.auto-rollback',
              env: p.env,
              component: p.moduleKey,
              status: 'success',
              detail: `验证失败自动回滚: ${p.env}/${p.moduleKey} → ${prevVersion}（task=${rollTask}）`,
            });
          } catch (re) {
            p.logs = [...(p.logs ?? []), `自动回滚失败: ${(re as Error).message}`];
            this.logger.error(`自动回滚失败: ${(re as Error).message}`);
            await this.auditService.log({
              user: p.operator || 'unknown',
              action: 'pipeline.auto-rollback',
              env: p.env,
              component: p.moduleKey,
              status: 'failed',
              detail: `验证失败自动回滚异常: ${(re as Error).message}`,
            });
          }
        }
        await this.auditService.log({
          user: p.operator || 'unknown',
          action: 'pipeline.finish',
          env: p.env,
          component: p.moduleKey,
          status: 'failed',
          detail: `发布失败: ${p.env}/${p.moduleKey}（阶段 ${p.stage}）: ${msg}`,
        });
      }
    } finally {
      this.cancelled.delete(p.id);
    }
  }

  /** 默认投递目标：配置优先，未配置时本机优先（本地开发直投本机静态目录） */
  private resolveDefaultTarget(): 'local' | 'remote' {
    const cfg = this.configService.get<string>('PIPELINE_UPLOAD_TARGET');
    if (cfg === 'local' || cfg === 'remote') return cfg;
    return 'local';
  }

  // ── 发布脚本 Hook（开发者可自定义各阶段 shell）──────────────────

  /**
   * 执行某阶段的自定义脚本。
   * @returns true=有 hook 且已执行；false=未配置 hook（调用方继续走内置逻辑）
   */
  private async runHook(p: DeployPipelineEntity, stage: string): Promise<boolean> {
    const hook = await this.hookService.resolveScript(p.moduleKey, stage);
    if (!hook) return false;

    this.assertNotCancelled(p);
    await this.enterStage(p, stage as any, `执行自定义脚本: ${p.moduleKey}/${stage}`);

    let mod: any = null;
    try {
      mod = await this.moduleRegistry.get(p.moduleKey);
    } catch {
      /* 查不到模块信息时 env 留空 */
    }

    const env: Record<string, string> = {
      DEPLOY_ENV: p.env || '',
      MODULE_KEY: p.moduleKey,
      BRANCH: p.gitBranch || '',
      COMMIT_ID: p.versionTag || '',
      RELEASE_DIR: this.releaseWorkspace,
      STAGE: stage,
      MODULE_TYPE: mod?.type || p.moduleType || '',
      MODULE_DIR: mod?.dir || '',
      PM2_NAME: mod?.pm2 || p.moduleKey,
    };
    p.logs = [...(p.logs ?? []), `[hook:${stage}] 执行 ${hook.file}`];
    await this.save(p);

    const code = await this.runScriptFile(hook.file, env, p);
    if (code !== 0) {
      throw new Error(`[hook:${stage}] 自定义脚本执行失败（exit ${code}），详见日志`);
    }
    p.logs = [...(p.logs ?? []), `[hook:${stage}] 自定义脚本完成`];
    await this.save(p);
    return true;
  }

  /** 执行 hook 脚本文件（bash），输出流式进流水线日志 */
  private runScriptFile(
    file: string,
    env: Record<string, string>,
    p: DeployPipelineEntity,
  ): Promise<number> {
    return new Promise((resolve) => {
      const child = spawn('bash', [file], {
        env: {
          ...process.env,
          ...env,
          PATH: `${process.env.PATH ?? ''}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${this.nodeBinDir}`,
        },
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), BUILD_TIMEOUT_MS);
      const pushLog = (line: string) => {
        p.logs = [...(p.logs ?? []), line];
        this.save(p).catch(() => undefined);
      };
      child.stdout.on('data', (d: Buffer) => {
        for (const line of String(d).split('\n').filter(Boolean)) pushLog(line);
      });
      child.stderr.on('data', (d: Buffer) => {
        for (const line of String(d).split('\n').filter(Boolean)) pushLog(`[stderr] ${line}`);
      });
      child.on('close', (code: number) => {
        clearTimeout(timer);
        resolve(code ?? 1);
      });
      child.on('error', (err: Error) => {
        clearTimeout(timer);
        pushLog(`[hook] 脚本启动失败: ${err.message}`);
        resolve(1);
      });
    });
  }

  private async save(p: DeployPipelineEntity): Promise<void> {
    await this.pipelineRepo.save(p).catch((e) => this.logger.warn(`保存流水线失败: ${e.message}`));
  }

  private assertNotCancelled(p: DeployPipelineEntity): void {
    if (this.cancelled.has(p.id)) {
      throw new Error('流水线已被取消');
    }
  }

  private async enterStage(p: DeployPipelineEntity, stage: string, message: string): Promise<void> {
    this.assertNotCancelled(p);
    const index = PIPELINE_STAGES.indexOf(stage as any);
    p.stage = stage;
    p.progress = { current: index + 1, total: PIPELINE_STAGES.length, message };
    p.logs = [...(p.logs ?? []), `[${new Date().toISOString()}] [${stage}] ${message}`];
    await this.save(p);
  }

  /**
   * 执行外部命令（git / tar / scp / ssh 等）。
   *
   * 统一补齐常见命令目录：pm2 或 nohup 拉起的进程 PATH 可能极不完整
   * （线上出现过 `git: command not found`、`spawn npx ENOENT`），
   * 流水线不能依赖启动时的 shell PATH。
   */
  private exec(cmd: string, cwd = this.releaseWorkspace): string {
    return execSync(cmd, {
      cwd,
      encoding: 'utf-8',
      env: {
        ...process.env,
        // pm2 / npx / pnpm 都是 node 脚本，PATH 必须包含 node 安装目录，
        // 否则子进程报 `env: node: No such file or directory`
        PATH: `${process.env.PATH ?? ''}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${this.nodeBinDir}`,
      },
    });
  }

  private gitShortHead(ws = this.releaseWorkspace): string {
    return this.exec('git rev-parse --short HEAD', ws).trim();
  }

  private gitBranch(ws = this.releaseWorkspace): string {
    return this.exec('git rev-parse --abbrev-ref HEAD', ws).trim();
  }

  /**
   * 阶段 1：校验模块类型、目标分支、commit 与 prod 约束。
   *
   * 发布语义（基于 git 拉取）：目标 = 远程仓库的 <branch>@<commitId>，
   * 由 pull 阶段在发布目录拉取，不再基于当前工作区代码。
   */
  private async stageCheck(p: DeployPipelineEntity): Promise<void> {
    await this.enterStage(p, 'check', '校验模块、分支与目标版本');
    const mod = await this.moduleRegistry.get(p.moduleKey);
    if (!['micro-frontend', 'frontend', 'backend'].includes(mod.type)) {
      throw new BadRequestException(
        `模块 ${p.moduleKey} 类型为 ${mod.type}，流水线暂不支持（支持 micro-frontend/frontend/backend）`,
      );
    }
    p.moduleType = mod.type;

    // 目标分支：未指定默认 master（与 prod 约束一致）
    const branch = p.gitBranch || 'master';
    p.gitBranch = branch;

    // ── 按 commit 发布 ──────────────────────────────────────────
    // 指定了 commitId（即 versionTag）：
    //   1) 发布目录已有该版本产物 → 复用产物，跳过 pull/build（秒级发布历史版本）
    //   2) 无产物 → 走 pull 拉取该 commit 后构建
    // 未指定 → 发该分支最新 commit（pull 后确定）
    if (p.versionTag) {
      p.reuseArtifact = this.hasArtifact(p.moduleKey, p.versionTag);
      if (p.reuseArtifact) {
        const history = await this.versionRepo.findOne({ where: { versionTag: p.versionTag } });
        p.gitCommit = history?.gitCommit ?? p.versionTag;
        p.logs = [
          ...(p.logs ?? []),
          `复用已有产物: ${p.moduleKey}/${p.versionTag}（跳过拉取与构建）`,
        ];
      }
    } else {
      p.reuseArtifact = false;
    }

    if (p.env === 'prod' && branch !== 'master') {
      throw new BadRequestException(`现网仅允许发布 master 分支版本，目标分支: ${branch}`);
    }
    await this.save(p);
  }

  /**
   * 阶段 2：发布目录 git 拉取（fetch → checkout 分支 → reset commit → clean）。
   *
   * 发布目录与开发工作区隔离；每次发布都保证代码 = 目标 commit，
   * 不会出现「本地未提交代码被发出去」的情况。
   */
  private async stagePull(p: DeployPipelineEntity): Promise<void> {
    await this.enterStage(
      p,
      'pull',
      `拉取代码: ${p.gitBranch}@${p.versionTag || '最新'}`,
    );
    const ws = this.releaseWorkspace;
    if (!fs.existsSync(path.join(ws, '.git'))) {
      throw new BadRequestException(
        `发布目录不存在: ${ws}。请先初始化：git clone git@github.com:web5/web_system.git ${ws}`,
      );
    }

    // fetch 远程 → 检出目标分支（本地无则从 origin 建）
    this.exec('git fetch --all --prune', ws);
    this.exec(
      `git checkout -B ${p.gitBranch} origin/${p.gitBranch} 2>/dev/null || git checkout -B ${p.gitBranch} ${p.gitBranch}`,
      ws,
    );

    // 指定 commit 则强制 reset（校验 commit 存在，不存在会抛错）
    if (p.versionTag) {
      this.exec(`git reset --hard ${p.versionTag}`, ws);
    }
    // 清理未跟踪文件/目录，避免残留污染构建
    this.exec('git clean -fd', ws);

    // 以实际 HEAD 为准记录 commit（未指定 commit 时即分支最新）
    p.gitCommit = this.gitShortHead(ws);
    p.versionTag = p.gitCommit;
    p.logs = [
      ...(p.logs ?? []),
      `代码已就绪: ${p.gitBranch}@${p.gitCommit}（发布目录 ${ws}）`,
    ];

    // 依赖同步：pnpm-lock.yaml 变化才重装（避免每次全量 install）
    this.ensureDeps(ws, p);

    await this.save(p);
  }

  /** 依赖清单（pnpm-lock.yaml）变化时执行 pnpm install；以 .deploy-lock-hash 记录上次清单 */
  private ensureDeps(ws: string, p: DeployPipelineEntity): void {
    try {
      const lockFile = path.join(ws, 'pnpm-lock.yaml');
      if (!fs.existsSync(lockFile)) return;
      const hash = this.md5(fs.readFileSync(lockFile));
      const hashFile = path.join(ws, '.deploy-lock-hash');
      const last = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, 'utf-8') : '';
      if (hash === last) return;
      p.logs = [...(p.logs ?? []), '依赖清单变化，执行 pnpm install...'];
      this.exec(`"${this.pnpmBin}" install --prefer-offline`, ws);
      fs.writeFileSync(hashFile, hash);
      p.logs = [...(p.logs ?? []), '依赖安装完成'];
    } catch (e) {
      // 依赖安装失败不阻断后续（构建阶段会再次报错并给出清晰信息）
      p.logs = [...(p.logs ?? []), `[warn] 依赖同步失败: ${(e as Error).message}`];
    }
  }

  private md5(buf: Buffer): string {
    return crypto.createHash('md5').update(buf).digest('hex');
  }

  /** 发布目录是否已有该模块的指定版本产物 */
  private hasArtifact(moduleKey: string, versionTag: string): boolean {
    const dir = path.join(
      this.releaseWorkspace,
      'servers',
      'gateway',
      'public',
      'static',
      'modules',
      moduleKey,
      versionTag,
    );
    return fs.existsSync(path.join(dir, 'index.js'));
  }

  /** 阶段 3：构建。前端 vite build --mode mf；后端 nest build */
  private async stageBuild(p: DeployPipelineEntity): Promise<void> {
    await this.enterStage(p, 'build', `构建 ${p.moduleKey}（${p.moduleType}）`);
    const mod = await this.moduleRegistry.get(p.moduleKey);
    const ws = this.releaseWorkspace;
    if (p.moduleType === 'backend') {
      this.buildBackend(p, ws, mod.dir);
    } else {
      await this.buildFrontend(p, ws, mod.dir);
    }
    await this.save(p);
  }

  /** 后端构建：nest build（发布目录 servers/<dir>） */
  private buildBackend(p: DeployPipelineEntity, ws: string, dir: string): void {
    const serverDir = path.join(ws, 'servers', dir);
    p.logs = [...(p.logs ?? []), `后端构建: ${dir}`];
    try {
      this.exec(`"${this.npxBin}" --no-install nest build`, serverDir);
    } catch (e) {
      throw new Error(`后端构建失败（${dir}）: ${(e as Error).message}`);
    }
    if (!fs.existsSync(path.join(serverDir, 'dist', 'main.js'))) {
      throw new Error(`后端构建产物缺失: ${serverDir}/dist/main.js`);
    }
    p.logs = [...(p.logs ?? []), `后端构建完成: ${dir} -> dist/`];
  }

  /** 前端构建：vite build --mode mf（发布目录 apps/<dir>） */
  private async buildFrontend(p: DeployPipelineEntity, ws: string, dir: string): Promise<void> {
    const appDir = path.join(ws, 'apps', dir);

    // 1. 确保 workspace 依赖包已构建（@web-system/shared / types 的 main 指向 dist，
    //    发布目录 clone 后 dist 不被 git 管理，缺失会导致 vite 解析失败）
    try {
      this.exec(`"${this.pnpmBin}" --filter @web-system/shared build`, ws);
      this.exec(`"${this.pnpmBin}" --filter @web-system/types build`, ws);
    } catch (e) {
      throw new Error(`workspace 依赖包构建失败: ${(e as Error).message}`);
    }

    // 2. 预建 dist 目录（部分 vite 插件构建时写 dist/version.json，目录缺失会 ENOENT）
    fs.mkdirSync(path.join(appDir, 'dist'), { recursive: true });

    // 优先用 node 直接执行 vite 的 bin 入口。
    // 原因：pm2 拉起的服务进程 PATH 可能不含 npx（曾出现 spawn npx ENOENT），
    // 直接用 process.execPath + vite bin 绝对路径可摆脱对 shell PATH 的依赖。
    const viteBin = [
      path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js'),
      path.join(this.releaseWorkspace, 'node_modules', 'vite', 'bin', 'vite.js'),
    ].find((f) => fs.existsSync(f));
    const cmd = viteBin ? process.execPath : 'npx';
    const args = viteBin ? [viteBin, 'build', '--mode', 'mf'] : ['vite', 'build', '--mode', 'mf'];
    if (!viteBin) {
      p.logs = [...(p.logs ?? []), '警告: 未找到 vite bin，回退 npx（依赖 PATH）'];
    }

    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(cmd, args, {
        cwd: appDir,
        env: {
          ...process.env,
          RELEASE_TAG: p.versionTag!,
          MF_FORMAT: 'system',
          // 兜底补齐常见 node 安装目录
          PATH: `${process.env.PATH ?? ''}:/usr/local/bin:/opt/homebrew/bin`,
        },
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), BUILD_TIMEOUT_MS);
      child.stdout.on('data', (d: Buffer) => {
        const line = d.toString().trim();
        if (line) p.logs = [...(p.logs ?? []), line];
      });
      child.stderr.on('data', (d: Buffer) => {
        const line = d.toString().trim();
        if (line) p.logs = [...(p.logs ?? []), `[stderr] ${line}`];
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (c: number) => {
        clearTimeout(timer);
        resolve(c);
      });
    });

    if (code !== 0) {
      throw new Error(`构建失败，退出码 ${code}（详见日志尾部）`);
    }

    const dist = path.join(appDir, 'dist');
    if (!fs.existsSync(path.join(dist, 'index.js'))) {
      throw new Error(`构建产物缺失: ${dist}/index.js`);
    }
    await this.save(p);
  }

  /** 阶段 4：前端产物投递到发布目录的 nginx 静态目录 */
  private async stageUpload(p: DeployPipelineEntity, target: 'local' | 'remote'): Promise<void> {
    await this.enterStage(p, 'upload', `投递产物（${target}）`);
    const mod = await this.moduleRegistry.get(p.moduleKey);
    const src = path.join(this.releaseWorkspace, 'apps', mod.dir, 'dist');

    if (target === 'local') {
      const dest = path.join(
        this.releaseWorkspace,
        'servers',
        'gateway',
        'public',
        'static',
        'modules',
        p.moduleKey,
        p.versionTag!,
      );
      fs.mkdirSync(dest, { recursive: true });
      // 清空旧内容后再拷，避免残留过期文件
      for (const f of fs.readdirSync(dest)) {
        fs.rmSync(path.join(dest, f), { recursive: true, force: true });
      }
      fs.cpSync(src, dest, { recursive: true });
      p.logs = [...(p.logs ?? []), `产物已投递到 ${dest}`];
    } else {
      // 远程投递：scp 到服务器静态目录（服务器信息来自 deploy_servers）
      const dest = `/data/web_system/servers/gateway/public/static/modules/${p.moduleKey}/${p.versionTag}`;
      const { remoteHost, remoteUser } = this.readRemoteTarget(p);
      const sshTarget = remoteUser ? `${remoteUser}@${remoteHost}` : remoteHost;
      const tar = `/tmp/${p.moduleKey}-${p.versionTag}.tar.gz`;
      if (fs.existsSync(tar)) fs.rmSync(tar);
      this.exec(`tar czf ${tar} -C ${src} .`);
      this.exec(`scp -o ConnectTimeout=15 ${tar} ${sshTarget}:/tmp/`);
      this.exec(
        `ssh -o ConnectTimeout=15 ${sshTarget} "mkdir -p ${dest} && cd ${dest} && rm -rf ./* && tar xzf /tmp/${path.basename(
          tar,
        )} && rm -f /tmp/${path.basename(tar)}"`,
      );
      fs.rmSync(tar, { force: true });
      p.logs = [...(p.logs ?? []), `产物已投递到 ${sshTarget}:${dest}`];
    }

    p.result = {
      ...(p.result ?? {}),
      artifactPath: `/static/modules/${p.moduleKey}/${p.versionTag}/`,
      target,
    };
    await this.save(p);
  }

  /**
   * 阶段 4（后端）：重启服务。
   *
   * 前提：本机 pm2 的服务脚本已指向发布目录（RELEASE_WORKSPACE），
   * 因此 restart 即加载发布目录刚构建好的 dist，运行的就是本次发布的代码。
   */
  /**
   * 解析实际 pm2 服务名。模块注册表的 pm2 字段与实际 pm2 名经常不一致
   * （如 todo-service → web-todo、auth-service → web-auth），按常见命名生成候选：
   *   mod.pm2 / web-<key> / web-<去-service 后缀> / <key> / <去-service 后缀>
   */
  private resolvePm2Names(p: DeployPipelineEntity, mod: any): string[] {
    const base = p.moduleKey.endsWith('-service')
      ? p.moduleKey.replace(/-service$/, '')
      : p.moduleKey;
    const names = [
      mod?.pm2,
      `web-${p.moduleKey}`,
      `web-${base}`,
      p.moduleKey,
      base,
    ].filter((n): n is string => !!n);
    return [...new Set(names)];
  }

  private async stageRestart(p: DeployPipelineEntity): Promise<void> {
    await this.enterStage(p, 'restart', `重启服务: ${p.moduleKey}`);
    const mod = await this.moduleRegistry.get(p.moduleKey);

    // pm2 restart 对不存在的进程报错但退出码可能是 0，不能依赖退出码判断。
    // 先用 jlist 确认实际存在的服务名，再只 restart 存在的。
    let names: string[] = [];
    try {
      const jlist = this.exec(`"${this.pm2Bin}" jlist`);
      const apps = JSON.parse(jlist) as Array<{ name?: string }>;
      const exists = new Set(apps.map((a) => a.name));
      names = this.resolvePm2Names(p, mod).filter((n) => exists.has(n));
    } catch {
      // jlist 失败时退回顺序尝试
      names = this.resolvePm2Names(p, mod);
    }
    if (names.length === 0) {
      throw new Error(
        `pm2 中未找到服务（尝试 ${this.resolvePm2Names(p, mod).join(' / ')}），请确认服务已用 pm2 纳管`,
      );
    }

    const restarted = names[0];
    this.exec(`"${this.pm2Bin}" restart ${restarted} --update-env`);
    p.logs = [...(p.logs ?? []), `服务已重启: ${restarted}`];
    p.result = { ...(p.result ?? {}), restarted };
    await this.save(p);
  }

  /** 读取远程投递目标（deploy-console 环境变量，未配置则抛错提示走 local） */
  private readRemoteTarget(p: DeployPipelineEntity): { remoteHost: string; remoteUser?: string } {
    const host = p.env === 'prod'
      ? this.configService.get<string>('PROD_SERVER')
      : this.configService.get<string>('DEV_SERVER');
    const user = p.env === 'prod'
      ? this.configService.get<string>('PROD_USER')
      : this.configService.get<string>('DEV_USER');
    if (!host) {
      throw new BadRequestException(
        `未配置 ${p.env} 服务器地址（DEV_SERVER/PROD_SERVER），无法远程投递；可改用 target=local`,
      );
    }
    return { remoteHost: host, remoteUser: user };
  }

  /** 阶段 4：写版本记录（deploy_versions，库为 web_system_deploy） */
  private async stageVersion(p: DeployPipelineEntity): Promise<void> {
    await this.enterStage(p, 'version', '写入版本记录');
    const v = new DeployVersionEntity();
    v.env = p.env;
    v.component = p.moduleKey;
    v.versionTag = p.versionTag!;
    v.gitCommit = p.gitCommit;
    v.gitBranch = p.gitBranch;
    v.releasedBy = p.operator;
    v.releasedAt = new Date();
    v.status = 'active';
    v.taskId = p.id;
    v.note = p.mode === 'grayscale' ? '流水线灰度发布' : '流水线发布';
    await this.versionRepo.save(v);
    p.logs = [...(p.logs ?? []), `版本记录已写入: ${p.versionTag}`];
    await this.save(p);
  }

  /** 阶段 5：切指针（direct）或写灰度规则（grayscale） */
  private async stagePointer(p: DeployPipelineEntity): Promise<void> {
    if (p.mode === 'grayscale') {
      await this.enterStage(p, 'pointer', '写入灰度规则（不切 stable 指针）');
      const rule = await this.canaryService.create({
        envId: p.env,
        moduleKey: p.moduleKey,
        canaryVersion: p.versionTag!,
        matchRule: p.grayscaleRule as any,
        enabled: true,
      });
      p.canaryRuleId = rule.id;
      p.logs = [...(p.logs ?? []), `灰度规则已创建: ${rule.id} → ${p.versionTag}`];
      await this.save(p);
      return;
    }

    await this.enterStage(p, 'pointer', '切换当前版本指针');
    const existing = await this.deploymentRepo.findOne({
      where: { envId: p.env, moduleKey: p.moduleKey },
    });
    const row = existing ?? new DeployDeploymentEntity();
    row.envId = p.env;
    row.moduleKey = p.moduleKey;
    row.currentVersion = p.versionTag!;
    row.status = 'deployed';
    row.deployedAt = new Date();
    row.deployedBy = p.operator;
    row.taskId = p.id;
    await this.deploymentRepo.save(row);
    p.logs = [...(p.logs ?? []), `指针已切换: ${p.env}/${p.moduleKey} → ${p.versionTag}`];
    await this.save(p);
  }

  /**
   * 阶段 7：验证。
   * 前端：等 gateway TTL 过期后断言 __manifest__ 版本已更新（历史坑：不等 TTL 会读到旧版本）
   * 后端：验证 pm2 服务在线
   */
  private async stageVerify(p: DeployPipelineEntity): Promise<void> {
    await this.enterStage(p, 'verify', '验证发布结果');

    if (p.moduleType === 'backend') {
      await this.verifyBackend(p);
      return;
    }

    const artifactUrl = `${this.gatewayUrl}/static/modules/${p.moduleKey}/${p.versionTag}/index.js`;
    const artifactOk = await this.httpHeadOk(artifactUrl);
    p.result = { ...(p.result ?? {}), artifactOk };

    if (p.mode === 'grayscale') {
      if (!artifactOk) {
        throw new Error(`灰度产物不可访问: ${artifactUrl}`);
      }
      p.logs = [...(p.logs ?? []), `灰度产物可访问: ${artifactUrl}`];
      await this.save(p);
      return;
    }

    // 等 gateway 版本缓存 TTL 过期（历史坑：改完版本表立刻查会拿到旧版本）
    await this.sleep((GATEWAY_VERSION_TTL_SEC + 2) * 1000);

    const manifest = await this.fetchManifest();
    const entry = (manifest?.modules ?? []).find(
      (m: any) => m.name === p.moduleKey || m.key === p.moduleKey,
    );
    const online = entry?.version;
    p.result = { ...(p.result ?? {}), manifestVersion: online ?? null };

    if (online && online !== p.versionTag) {
      throw new Error(
        `验证失败：gateway manifest 版本为 ${online}，期望 ${p.versionTag}（TTL 已等待仍不一致，请检查 gateway 缓存或产物路径）`,
      );
    }
    if (!online) {
      throw new Error(`验证失败：manifest 中未找到模块 ${p.moduleKey}`);
    }
    p.logs = [...(p.logs ?? []), `manifest 已确认: ${p.moduleKey} → ${online}`];
    await this.save(p);
  }

  /** 后端验证：pm2 服务重启后保持 online，且端口真实可服务（避免「进程在但端口没起」的假健康） */
  private async verifyBackend(p: DeployPipelineEntity): Promise<void> {
    const mod = await this.moduleRegistry.get(p.moduleKey);
    const names = this.resolvePm2Names(p, mod);
    let ok = false;
    let healthCheck: { port?: string | number; ok?: boolean; checkedAt?: string; note?: string } = {};
    for (let i = 0; i < 12; i++) {
      await this.sleep(2000);
      try {
        const jlist = this.exec(`"${this.pm2Bin}" jlist`);
        const apps = JSON.parse(jlist) as Array<{
          name?: string;
          pm2_env?: { status?: string; PORT?: string | number };
        }>;
        for (const name of names) {
          const app = apps.find((a) => a.name === name);
          const status = app?.pm2_env?.status;
          if (status === 'online') {
            ok = true;
            p.logs = [...(p.logs ?? []), `服务在线: ${name}`];
            // 真实端口探活：pm2 online 仅代表进程存活，端口在监听才是真健康
            const port = app?.pm2_env?.PORT;
            if (port) {
              const probe = await this.httpRequest(`http://127.0.0.1:${port}/`, 'GET', 3000);
              const reachable = probe.status > 0;
              healthCheck = { port, ok: reachable, checkedAt: new Date().toISOString() };
              p.logs = [
                ...(p.logs ?? []),
                `端口探活 ${port}: ${reachable ? '健康' : `未响应(HTTP ${probe.status})`}`,
              ];
            } else {
              healthCheck = { note: 'pm2_env.PORT 缺失，降级为进程状态探活', ok: undefined };
            }
            break;
          }
          p.logs = [...(p.logs ?? []), `等待服务上线: ${name}（${status || '未找到'}）`];
        }
        if (ok) break;
      } catch {
        // 查询失败继续轮询
      }
    }
    p.result = { ...(p.result ?? {}), online: ok, healthCheck };
    if (!ok) {
      throw new Error(`服务重启后未在线: ${p.moduleKey}（请查看 pm2 logs）`);
    }
    // 探活结果审计留痕
    await this.auditService.log({
      user: p.operator || 'unknown',
      action: 'pipeline.verify.healthcheck',
      env: p.env,
      component: p.moduleKey,
      status: healthCheck.ok === false ? 'warn' : 'success',
      detail: `发布后健康检查: ${p.moduleKey} → ${p.versionTag}（port=${healthCheck.port ?? 'n/a'}, ok=${healthCheck.ok ?? 'n/a'}）`,
    });
    await this.save(p);
  }

  /** 阶段 8：清理旧版本目录，保留最近 KEEP_VERSIONS 个（受保护版本不删）；后端无产物不清理 */
  private async stageCleanup(p: DeployPipelineEntity): Promise<void> {
    await this.enterStage(p, 'cleanup', '清理历史版本');
    if (p.moduleType === 'backend') {
      p.logs = [...(p.logs ?? []), '后端模块无静态产物，跳过清理'];
      await this.save(p);
      return;
    }
    if (this.resolveDefaultTarget() !== 'local') {
      p.logs = [...(p.logs ?? []), '远程投递模式跳过本地清理'];
      await this.save(p);
      return;
    }

    const base = path.join(this.releaseWorkspace, 'servers', 'gateway', 'public', 'static', 'modules', p.moduleKey);
    if (!fs.existsSync(base)) {
      await this.save(p);
      return;
    }

    // 受保护：当前版本 + 所有启用中的灰度版本
    const protectedVersions = new Set<string>([p.versionTag!]);
    try {
      const rules = await this.canaryService.list(p.env, p.moduleKey);
      for (const r of rules) {
        if (r.enabled) protectedVersions.add(r.canaryVersion);
      }
    } catch (e) {
      this.logger.warn(`读取灰度规则失败，清理时可能误删: ${(e as Error).message}`);
    }

    const dirs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(base, d.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    const kept: string[] = [];
    const removed: string[] = [];
    for (const d of dirs) {
      if (protectedVersions.has(d.name) || kept.length < KEEP_VERSIONS) {
        kept.push(d.name);
        continue;
      }
      fs.rmSync(path.join(base, d.name), { recursive: true, force: true });
      removed.push(d.name);
    }

    p.result = { ...(p.result ?? {}), kept, removed };
    p.logs = [...(p.logs ?? []), `清理完成，保留 ${kept.length} 个版本${removed.length ? `，删除: ${removed.join(', ')}` : ''}`];
    await this.save(p);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 简单的 GET 请求（JSON）。
   *
   * 注意：这里**不能用 fetch** —— Node 的 fetch(undici) 会拦截 6000 等端口
   * （X11 等被列入 bad port 名单），导致访问 gateway 直接失败。改用 http 模块。
   */
  private httpRequest(
    url: string,
    method: 'GET' | 'HEAD',
    timeoutMs = 10_000,
  ): Promise<{ ok: boolean; status: number; json?: any }> {
    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, { method, timeout: timeoutMs }, (res) => {
        const status = res.statusCode ?? 0;
        const ok = status >= 200 && status < 300;

        if (method === 'HEAD') {
          res.resume();
          res.on('end', () => resolve({ ok, status }));
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          // 状态码与 JSON 解析分开判定：产物文件（.js）不是 JSON，解析失败不代表不可访问
          let json: any;
          try {
            json = JSON.parse(data);
          } catch {
            json = undefined;
          }
          resolve({ ok, status, json });
        });
      });
      req.on('error', () => resolve({ ok: false, status: 0 }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0 });
      });
      req.end();
    });
  }

  /** 产物可访问性检查（HEAD，避免下载整个产物） */
  private async httpHeadOk(url: string): Promise<boolean> {
    const res = await this.httpRequest(url, 'HEAD');
    return res.ok;
  }

  /**
   * 查询 gateway 模块清单（验证版本是否生效）。
   * 兼容两种响应：裸 {modules:[...]} 与全局拦截器包装 {code,data:{modules:[...]}}
   */
  private async fetchManifest(): Promise<{ modules?: Array<{ name?: string; key?: string; version?: string }> } | null> {
    const res = await this.httpRequest(`${this.gatewayUrl}/__manifest__`, 'GET');
    if (!res.ok || !res.json) {
      this.logger.warn(`查询 manifest 失败: HTTP ${res.status}`);
      return null;
    }
    const data = res.json?.data ?? res.json;
    return (data ?? null) as { modules?: Array<{ name?: string; key?: string; version?: string }> } | null;
  }
}
