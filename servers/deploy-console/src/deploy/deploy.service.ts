import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter } from 'events';
import { spawn, exec, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from 'ssh2';
import { DeployTaskEntity } from '../entities/deploy-task.entity';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { EnvironmentService } from '../environment/environment.service';

/**
 * 任务状态枚举
 */
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

/**
 * 任务类型枚举
 */
export type TaskType = 'build' | 'deploy' | 'rollback';

/**
 * 部署任务（内存对象，供 SSE 实时推流；持久化镜像见 DeployTaskEntity）
 */
export interface DeployTask {
  id: string;
  type: TaskType;
  env?: string;
  component: string;
  tag?: string;
  status: TaskStatus;
  logs: string[];
  startTime: number;
  endTime?: number;
  error?: string;
  operator?: string;
}

/**
 * 部署服务
 * 使用 child_process.spawn 执行构建和部署脚本
 * 通过 EventEmitter 发送实时进度事件，供 SSE 控制器订阅
 * 任务与版本记录持久化到 MySQL（deploy_tasks / deploy_versions）
 */
@Injectable()
export class DeployService {
  private readonly logger = new Logger(DeployService.name);
  /** 运行中的任务实时对象（进程内存，供 SSE 推流；历史以 DB 为准） */
  private readonly tasks = new Map<string, DeployTask>();
  private readonly progressEmitter = new EventEmitter();

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(DeployTaskEntity)
    private readonly taskRepo: Repository<DeployTaskEntity>,
    @InjectRepository(DeployVersionEntity)
    private readonly versionRepo: Repository<DeployVersionEntity>,
    @InjectRepository(DeployDeploymentEntity)
    private readonly deploymentRepo: Repository<DeployDeploymentEntity>,
    private readonly environmentService: EnvironmentService,
  ) {
    // 增加 EventEmitter 的最大监听器数
    this.progressEmitter.setMaxListeners(50);
  }

  /**
   * 获取进度事件发射器
   */
  getProgressEmitter(): EventEmitter {
    return this.progressEmitter;
  }

  /**
   * 获取 WEB_SYSTEM_DIR 路径
   */
  private getWebSystemDir(): string {
    return this.configService.get<string>('WEB_SYSTEM_DIR') || '/data/web_system';
  }

  /**
   * 生成任务 ID
   */
  private generateTaskId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 生成版本标签: YYYYMMDD-HHMMSS-<git短哈希>
   */
  private generateVersionTag(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
      d.getHours(),
    )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    let commit = '';
    try {
      commit = execSync('git rev-parse --short HEAD', {
        cwd: this.getWebSystemDir(),
        encoding: 'utf-8',
      }).trim();
    } catch {
      commit = '';
    }
    return commit ? `${ts}-${commit}` : `${ts}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 创建任务（同时落库）
   */
  private async createTask(
    type: TaskType,
    component: string,
    env?: string,
    tag?: string,
    operator?: string,
  ): Promise<DeployTask> {
    const id = this.generateTaskId();
    const task: DeployTask = {
      id,
      type,
      env,
      component,
      tag,
      status: 'pending',
      logs: [],
      startTime: Date.now(),
      operator,
    };
    this.tasks.set(id, task);
    await this.taskRepo.save({
      id,
      type,
      env,
      component,
      tag,
      status: 'pending',
      logs: [],
      operator,
      startTime: task.startTime,
    });
    return task;
  }

  /**
   * 更新任务状态并写入数据库 + 发送进度事件
   */
  private async updateTask(
    task: DeployTask,
    status: TaskStatus,
    log?: string,
    error?: string,
  ) {
    task.status = status;
    if (log) {
      task.logs.push(log);
      this.progressEmitter.emit(`task:${task.id}`, { type: 'log', data: log });
    }
    if (error) {
      task.error = error;
    }

    const partial: Partial<DeployTaskEntity> = { status, logs: task.logs };
    if (error) partial.error = error;

    if (status === 'success' || status === 'failed' || status === 'cancelled') {
      task.endTime = Date.now();
      partial.endTime = task.endTime;
      this.progressEmitter.emit(`task:${task.id}`, { type: 'done', status, error: task.error });
      // 部署/回滚成功 → 记录版本 + 更新该环境该模块当前版本
      if (status === 'success' && (task.type === 'deploy' || task.type === 'rollback')) {
        await this.recordVersion(task);
        await this.recordDeployment(task);
      }
    }

    await this.taskRepo.update(task.id, partial).catch((e) => {
      this.logger.warn(`更新任务 ${task.id} 失败: ${e.message}`);
    });
  }

  /**
   * 记录发布版本（deploy 成功时调用）
   */
  private async recordVersion(task: DeployTask) {
    try {
      const dir = this.getWebSystemDir();
      let gitCommit: string | null = null;
      let gitBranch: string | null = null;
      try {
        gitCommit = execSync('git rev-parse --short HEAD', { cwd: dir, encoding: 'utf-8' }).trim() || null;
      } catch {
        gitCommit = null;
      }
      try {
        gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf-8' }).trim() || null;
      } catch {
        gitBranch = null;
      }
      const v = new DeployVersionEntity();
      v.env = task.env || '';
      v.component = task.component;
      v.versionTag = task.tag || task.id;
      v.gitCommit = gitCommit ?? undefined;
      v.gitBranch = gitBranch ?? undefined;
      v.releasedBy = task.operator;
      v.releasedAt = new Date();
      v.taskId = task.id;
      v.status = 'active';
      await this.versionRepo.save(v);
      this.logger.log(`版本记录已写入: ${task.tag} (${task.env}/${task.component})`);
    } catch (e) {
      this.logger.error(`写版本记录失败: ${e.message}`);
    }
  }

  /**
   * 更新环境-模块当前部署状态（「不同环境指定不同版本」核心）
   * 部署/回滚成功后 upsert (envId, moduleKey) 的当前版本
   */
  private async recordDeployment(task: DeployTask) {
    if (!task.env || !task.component) return;
    try {
      const existing = await this.deploymentRepo.findOne({
        where: { envId: task.env, moduleKey: task.component },
      });
      if (existing) {
        existing.currentVersion = task.tag || existing.currentVersion;
        existing.status = 'deployed';
        existing.deployedAt = new Date();
        existing.deployedBy = task.operator;
        existing.taskId = task.id;
        await this.deploymentRepo.save(existing);
      } else {
        const d = new DeployDeploymentEntity();
        d.envId = task.env;
        d.moduleKey = task.component;
        d.currentVersion = task.tag;
        d.status = 'deployed';
        d.deployedAt = new Date();
        d.deployedBy = task.operator;
        d.taskId = task.id;
        await this.deploymentRepo.save(d);
      }
      this.logger.log(`当前版本已更新: ${task.env}/${task.component} -> ${task.tag}`);
    } catch (e) {
      this.logger.error(`更新当前版本失败: ${e.message}`);
    }
  }

  /**
   * 查询某环境各模块的当前版本（供前端按环境展示）
   */
  async getCurrentVersions(env: string): Promise<any[]> {
    const rows = await this.deploymentRepo.find({ where: { envId: env } });
    const modules = await this.listModules();
    const map = new Map(modules.map((m: any) => [m.key, m]));
    return rows.map((r) => ({
      envId: r.envId,
      moduleKey: r.moduleKey,
      moduleName: map.get(r.moduleKey)?.name || r.moduleKey,
      currentVersion: r.currentVersion,
      status: r.status,
      deployedAt: r.deployedAt,
      deployedBy: r.deployedBy,
    }));
  }

  /**
   * 启动本地构建
   */
  async startBuild(component: string, operator?: string): Promise<string> {
    const task = await this.createTask('build', component, undefined, undefined, operator);
    const webSystemDir = this.getWebSystemDir();
    this.logger.log(`开始构建任务: ${task.id}, 组件: ${component}`);
    this.executeBuildScript(task, webSystemDir, component);
    return task.id;
  }

  /**
   * 启动部署（生成版本标签，传给部署脚本做 releases 快照）
   */
  async startDeploy(env: string, component: string, operator?: string): Promise<string> {
    const versionTag = this.generateVersionTag();
    const task = await this.createTask('deploy', component, env, versionTag, operator);
    const webSystemDir = this.getWebSystemDir();
    this.logger.log(`开始部署任务: ${task.id}, 环境: ${env}, 组件: ${component}, 版本: ${versionTag}`);
    this.executeDeployScript(task, webSystemDir, env, component, versionTag);
    return task.id;
  }

  /**
   * 启动回滚（回滚到指定版本 tag）
   */
  async startRollback(env: string, tag: string, operator?: string, component?: string): Promise<string> {
    const task = await this.createTask('rollback', component || 'system', env, tag, operator);
    const webSystemDir = this.getWebSystemDir();
    this.logger.log(`开始回滚任务: ${task.id}, 环境: ${env}, 标签: ${tag}`);
    this.executeRollbackScript(task, webSystemDir, env, tag);
    return task.id;
  }

  private executeBuildScript(task: DeployTask, webSystemDir: string, component: string) {
    const scriptPath = path.join(webSystemDir, 'scripts', 'build-all.sh');
    void this.updateTask(task, 'running', `执行构建: bash scripts/build-all.sh ${component}`);
    const child = spawn('bash', [scriptPath, component], { cwd: webSystemDir, env: { ...process.env } });
    child.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) void this.updateTask(task, 'running', line);
    });
    child.stderr.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) void this.updateTask(task, 'running', `[stderr] ${line}`);
    });
    child.on('close', (code: number) => {
      if (code === 0) void this.updateTask(task, 'success', `构建完成，退出码: ${code}`);
      else void this.updateTask(task, 'failed', `构建失败，退出码: ${code}`);
    });
    child.on('error', (err: Error) => void this.updateTask(task, 'failed', `构建执行错误: ${err.message}`));
  }

  private async executeDeployScript(
    task: DeployTask,
    webSystemDir: string,
    env: string,
    component: string,
    versionTag: string,
  ) {
    const scriptPath = path.join(webSystemDir, 'scripts', 'deploy.sh');
    void this.updateTask(task, 'running', `执行部署: bash scripts/deploy.sh ${env} ${component} ${versionTag}`);
    const envVars = await this.buildEnvVars(env);
    const child = spawn('bash', [scriptPath, env, component, versionTag], {
      cwd: webSystemDir,
      env: { ...process.env, ...envVars },
    });
    child.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) void this.updateTask(task, 'running', line);
    });
    child.stderr.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) void this.updateTask(task, 'running', `[stderr] ${line}`);
    });
    child.on('close', (code: number) => {
      if (code === 0) void this.updateTask(task, 'success', `部署完成，退出码: ${code}`);
      else void this.updateTask(task, 'failed', `部署失败，退出码: ${code}`);
    });
    child.on('error', (err: Error) => void this.updateTask(task, 'failed', `部署执行错误: ${err.message}`));
  }

  private async executeRollbackScript(
    task: DeployTask,
    webSystemDir: string,
    env: string,
    tag: string,
  ) {
    const scriptPath = path.join(webSystemDir, 'scripts', 'rollback.sh');
    void this.updateTask(task, 'running', `执行回滚: bash scripts/rollback.sh ${env} ${tag}`);
    const envVars = await this.buildEnvVars(env);
    const child = spawn('bash', [scriptPath, env, tag], { cwd: webSystemDir, env: { ...process.env, ...envVars } });
    child.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) void this.updateTask(task, 'running', line);
    });
    child.stderr.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) void this.updateTask(task, 'running', `[stderr] ${line}`);
    });
    child.on('close', (code: number) => {
      if (code === 0) void this.updateTask(task, 'success', `回滚完成，退出码: ${code}`);
      else void this.updateTask(task, 'failed', `回滚失败，退出码: ${code}`);
    });
    child.on('error', (err: Error) => void this.updateTask(task, 'failed', `回滚执行错误: ${err.message}`));
  }

  /**
   * 从 DB 环境表构造连接环境变量，注入给 deploy.sh/rollback.sh
   * 使任意环境（含自定义）都能被部署，无需手写 .env.deploy
   */
  private async buildEnvVars(env: string): Promise<Record<string, string>> {
    const e = await this.environmentService.get(env);
    return {
      DEPLOY_HOST: e.host,
      DEPLOY_USER: e.sshUser,
      DEPLOY_KEY: e.sshKeyPath || '~/.ssh/id_ed25519_servers',
      DEPLOY_REMOTE_DIR: e.remoteDir,
      DEPLOY_PUBLIC_URL: e.publicUrl || '',
    };
  }

  /**
   * 列出所有任务（读 DB，按 startTime 倒序）
   */
  async listTasks(): Promise<DeployTask[]> {
    // 合并 DB 历史与运行中任务（运行中优先取内存实时对象）
    const rows = await this.taskRepo.find({ order: { startTime: 'DESC' } });
    const memIds = new Set(this.tasks.keys());
    const running = Array.from(this.tasks.values()).filter((t) => !memIds.has(t.id) || true);
    const map = new Map<string, DeployTask>();
    for (const r of rows) map.set(r.id, this.rowToTask(r));
    for (const t of running) map.set(t.id, t); // 运行中覆盖 DB 镜像，保证实时
    return Array.from(map.values()).sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * 获取单个任务（运行中取内存，否则 DB）
   */
  async getTask(id: string): Promise<DeployTask> {
    const mem = this.tasks.get(id);
    if (mem) return mem;
    const row = await this.taskRepo.findOne({ where: { id } });
    if (!row) throw new BadRequestException(`任务不存在: ${id}`);
    return this.rowToTask(row);
  }

  private rowToTask(r: DeployTaskEntity): DeployTask {
    return {
      id: r.id,
      type: (r.type as TaskType) || 'deploy',
      env: r.env,
      component: r.component,
      tag: r.tag,
      status: (r.status as TaskStatus) || 'pending',
      logs: Array.isArray(r.logs) ? r.logs : [],
      startTime: Number(r.startTime),
      endTime: r.endTime != null ? Number(r.endTime) : undefined,
      error: r.error,
      operator: r.operator,
    };
  }

  /**
   * 列出发布版本（读 DB，按 releasedAt 倒序）
   */
  async listVersions(env?: string, component?: string): Promise<DeployVersionEntity[]> {
    const where: any = {};
    if (env) where.env = env;
    if (component) where.component = component;
    return this.versionRepo.find({ where, order: { releasedAt: 'DESC' } });
  }

  /**
   * 列出可发布模块（读 scripts/modules.json，作为前端/脚本唯一真相源）
   */
  async listModules(): Promise<any[]> {
    const file = path.join(this.getWebSystemDir(), 'scripts', 'modules.json');
    try {
      const raw = fs.readFileSync(file, 'utf-8');
      return JSON.parse(raw);
    } catch (e) {
      this.logger.warn(`读取 modules.json 失败: ${e.message}`);
      return [];
    }
  }

  /**
   * 列出远程可用快照（保留，实时 ls releases 目录）
   */
  async listReleases(env: string): Promise<string[]> {
    const sshConfig = await this.getSshConfig(env);
    const webSystemDir = this.getWebSystemDir();
    return new Promise((resolve, reject) => {
      const client = new Client();
      client.on('ready', () => {
        const releaseDir = `${webSystemDir}/releases`;
        client.exec(`ls -1 ${releaseDir} 2>/dev/null || echo ""`, (err, stream) => {
          if (err) {
            client.end();
            reject(new BadGatewayException(`SSH 执行失败: ${err.message}`));
            return;
          }
          let output = '';
          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });
          stream.on('close', () => {
            client.end();
            resolve(output.trim().split('\n').filter(Boolean));
          });
          stream.stderr.on('data', (data: Buffer) => {
            this.logger.warn(`SSH stderr: ${data.toString()}`);
          });
        });
      });
      client.on('error', (err: Error) => {
        reject(new BadGatewayException(`SSH 连接失败: ${err.message}`));
      });
      client.on('timeout', () => {
        client.end();
        reject(new BadGatewayException('SSH 连接超时'));
      });
      client.connect({ ...sshConfig, readyTimeout: 10000 });
    });
  }

  /**
   * 获取 SSH 配置（从 DB 环境表读取，支持任意环境 ID）
   */
  private async getSshConfig(env: string) {
    const envEntity = await this.environmentService.get(env);
    let privateKeyPath = envEntity.sshKeyPath || '~/.ssh/id_ed25519_servers';
    if (privateKeyPath.startsWith('~')) {
      privateKeyPath = privateKeyPath.replace(/^~/, process.env.HOME || '');
    }
    let privateKey: Buffer | undefined;
    if (fs.existsSync(privateKeyPath)) {
      privateKey = fs.readFileSync(privateKeyPath);
    }
    return { host: envEntity.host, port: 22, username: envEntity.sshUser, privateKey };
  }
}
