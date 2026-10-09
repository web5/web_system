import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployTaskEntity } from '../entities/deploy-task.entity';

/** 任务类型：与 DeployService 的 TaskType 对齐 */
export type RecordedTaskType = 'build' | 'deploy' | 'rollback';

export interface TaskMeta {
  type: RecordedTaskType;
  /** 组件名（微前端即 appKey，如 portal / admin） */
  component: string;
  env?: string;
  /** 标签：切版本时记目标版本，回滚时记目标版本 */
  tag?: string;
  operator?: string;
}

export interface RecordedTask {
  result: unknown;
  taskId: string;
}

/**
 * 任务留痕（诊断遗留④ / 2026-10-09）
 *
 * **为什么要有它**：非流水线的操作此前只在内存里跑，既不落 `deploy_tasks` 也没有别的留痕，
 * 表现为「UI 上点了一次切版本，事后查不到任何记录」—— 排查 5ba74517 那次发布失败时，
 * 只能靠 pm2 error log 反推，因为 `deploy_tasks` 里根本没有这条操作。
 *
 * 流水线路径已有 `DeployService.createTask`（build/deploy/rollback），**刻意不在本次改动范围内**：
 * 那条路径有自己的任务与 SSE 推送，重复建任务只会让列表出现两条。
 * 这里服务的是「UI 切换 / UI 回滚」这类**原本完全没有任务记录**的入口。
 *
 * 两条与既有实现一致的纪律：
 * 1. **留痕失败绝不阻断主流程**（写库挂了最多没记录，不能让发布发不出去）—— 但会打 error 日志。
 * 2. **失败也要留痕**：`record()` 捕获异常 → 落 failed + 错误原因 → 原样抛出，调用方的语义不变。
 */
@Injectable()
export class TaskRecorderService {
  private readonly logger = new Logger(TaskRecorderService.name);
  /** 日志缓冲：避免每条日志都读回一次整列 JSON */
  private readonly buffers = new Map<string, string[]>();

  constructor(
    @InjectRepository(DeployTaskEntity)
    private readonly repo: Repository<DeployTaskEntity>,
  ) {}

  private genId(): string {
    // 与 DeployService.generateTaskId 同款：${Date.now()}-${rand}
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /** 留痕写库失败只告警：它挂了不该让发布发不出去，但也不能静默失效 */
  private async safe(what: string, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (e) {
      this.logger.error(`任务留痕写入失败（${what}）：${(e as Error).message}`);
    }
  }

  async start(meta: TaskMeta): Promise<string> {
    const id = this.genId();
    const first = `${meta.type} 开始：${meta.component}${meta.env ? `/${meta.env}` : ''}`;
    this.buffers.set(id, [first]);
    await this.safe('start', () =>
      this.repo.save({
        id,
        type: meta.type,
        env: meta.env,
        component: meta.component,
        tag: meta.tag,
        status: 'running',
        logs: [first],
        operator: meta.operator,
        startTime: Date.now(),
      }),
    );
    return id;
  }

  async log(id: string, line: string): Promise<void> {
    const arr = this.buffers.get(id) ?? [];
    arr.push(line);
    this.buffers.set(id, arr);
    await this.safe('log', () => this.repo.update(id, { logs: arr }));
  }

  async finish(id: string, status: 'success' | 'failed', error?: string): Promise<void> {
    if (error) {
      const arr = this.buffers.get(id) ?? [];
      arr.push(`失败：${error}`);
      this.buffers.set(id, arr);
    }
    const logs = this.buffers.get(id);
    this.buffers.delete(id);
    await this.safe('finish', () =>
      this.repo.update(id, { status, endTime: Date.now(), error, ...(logs ? { logs } : {}) }),
    );
  }

  /**
   * 包装一段操作：开始 → 执行 → 成功/失败都落终态。
   * 异常**原样抛出**，调用方的成功/失败语义完全不变。
   */
  async record<T>(meta: TaskMeta, fn: (log: (line: string) => void) => Promise<T>): Promise<{ result: T; taskId: string }> {
    const taskId = await this.start(meta);
    const log = (line: string) => {
      void this.log(taskId, line);
    };
    try {
      const result = await fn(log);
      await this.finish(taskId, 'success');
      return { result, taskId };
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      await this.finish(taskId, 'failed', msg);
      throw e;
    }
  }
}
