import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineRunEntity } from '../entities/pipeline-run.entity';
import { PipelineService } from './pipeline.service';

/** 触发一次运行的受理结果（前端据此进入轮询） */
export interface RunAccepted {
  job_id: number;
  pipeline_code: string;
  status: 'running';
  /** true = 该管线已有在跑的任务，本次复用它，没有新起一个 */
  reused: boolean;
}

/** 运行任务视图（轮询返回） */
export interface RunJobView {
  job_id: number;
  pipeline_code: string;
  status: 'running' | 'ok' | 'failed';
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
  /** 仍在跑时的已耗时（毫秒），供前端显示"已运行 Ns" */
  elapsed_ms: number | null;
  collected: number;
  new_items: number;
  published: number;
  errors: number;
  error_msg: string | null;
}

/**
 * 管线运行的异步外壳（2026-10-23）
 *
 * 存在理由：管线一次完整运行要 30 秒以上，同步接口会被链路超时掐断
 * （前端 10s / 网关 content-admin 通道 30s / nginx 60s），调用方只看到「网络错误」，
 * 而后端仍在跑、内容仍会投出去 —— 比报错更糟：用户以为失败了，于是再点一次。
 *
 * 所以这里把「受理」和「执行」拆开：
 *   受理 POST  → 建一条 running 记录，立即返回 job_id（毫秒级，不受任何超时影响）
 *   执行       → 后台跑 pipelineService.run，跑完回写状态与四数结果
 *   查询 GET   → 前端轮询 job 拿结果
 *
 * 落在库里而不是进程内存，是为了重启不丢在途任务的判定（见 onModuleInit）
 * 以及同管线重复点击的去重。
 */
@Injectable()
export class PipelineRunService implements OnModuleInit {
  private readonly logger = new Logger(PipelineRunService.name);

  constructor(
    @InjectRepository(PipelineRunEntity)
    private readonly runRepo: Repository<PipelineRunEntity>,
    private readonly pipelineService: PipelineService,
  ) {}

  /**
   * 服务启动时回收在途任务。
   * 进程一重启，正在跑的后台执行上下文就没了，那些 running 永远等不到回写 ——
   * 不处理的话前端会一直轮询一个死任务。这里统一判死并留下原因。
   */
  async onModuleInit() {
    const r = await this.runRepo
      .createQueryBuilder()
      .update(PipelineRunEntity)
      .set({
        status: 'failed',
        finished_at: new Date(),
        error_msg: '服务重启，本次运行中断',
      })
      .where('status = :s', { s: 'running' })
      .execute();
    if (r.affected) {
      this.logger.warn(`启动回收：${r.affected} 条在途运行标记为失败`);
    }
  }

  /** 受理一次运行：同管线已有在跑任务则复用，否则新起一条并后台执行 */
  async start(code: string, trigger: 'manual' | 'schedule' = 'manual'): Promise<RunAccepted> {
    const running = await this.runRepo.findOne({
      where: { pipeline_code: code, status: 'running' },
      order: { id: 'DESC' },
    });
    if (running) {
      return {
        job_id: Number(running.id),
        pipeline_code: code,
        status: 'running',
        reused: true,
      };
    }

    const job = await this.runRepo.save(
      this.runRepo.create({
        pipeline_code: code,
        trigger_type: trigger,
        status: 'running',
        started_at: new Date(),
      }),
    );
    const jobId = Number(job.id);
    // 故意不 await：让接口先返回，执行留在后台
    void this.execute(jobId, code);
    return { job_id: jobId, pipeline_code: code, status: 'running', reused: false };
  }

  /** 后台执行：任何异常都要落到 job 上，不能让它静默挂在 running */
  private async execute(jobId: number, code: string) {
    const t0 = Date.now();
    try {
      const r = await this.pipelineService.run(code);
      await this.runRepo.update(jobId, {
        status: 'ok',
        finished_at: new Date(),
        duration_ms: Date.now() - t0,
        collected: r.collected,
        new_items: r.newItems,
        published: r.published,
        errors: r.errors,
      });
      this.logger.log(
        `运行 #${jobId} ${code} 完成：采集 ${r.collected} · 新增 ${r.newItems} · 发布 ${r.published} · 失败 ${r.errors}（${Date.now() - t0}ms）`,
      );
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      await this.runRepo.update(jobId, {
        status: 'failed',
        finished_at: new Date(),
        duration_ms: Date.now() - t0,
        error_msg: msg.slice(0, 500),
      });
      this.logger.error(`运行 #${jobId} ${code} 失败：${msg}`);
    }
  }

  /** 查询一次运行的结果 */
  async getJob(jobId: number): Promise<RunJobView | null> {
    const job = await this.runRepo.findOne({ where: { id: jobId } });
    if (!job) return null;
    const startMs = job.started_at ? job.started_at.getTime() : null;
    return {
      job_id: Number(job.id),
      pipeline_code: job.pipeline_code,
      status: job.status as RunJobView['status'],
      started_at: job.started_at,
      finished_at: job.finished_at,
      duration_ms: job.duration_ms,
      elapsed_ms: startMs && job.status === 'running' ? Date.now() - startMs : null,
      collected: job.collected,
      new_items: job.new_items,
      published: job.published,
      errors: job.errors,
      error_msg: job.error_msg,
    };
  }

  /** 最近运行记录（供页面回看，避免"刚才那次到底跑了没"要靠猜） */
  async listRecent(code?: string, take = 10): Promise<RunJobView[]> {
    const rows = await this.runRepo.find({
      where: code ? { pipeline_code: code } : {},
      order: { id: 'DESC' },
      take,
    });
    return rows.map((job) => ({
      job_id: Number(job.id),
      pipeline_code: job.pipeline_code,
      status: job.status as RunJobView['status'],
      started_at: job.started_at,
      finished_at: job.finished_at,
      duration_ms: job.duration_ms,
      elapsed_ms: null,
      collected: job.collected,
      new_items: job.new_items,
      published: job.published,
      errors: job.errors,
      error_msg: job.error_msg,
    }));
  }
}
