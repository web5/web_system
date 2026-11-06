/** 内容管线调度器——读 content_pipelines.cron 动态注册定时任务 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronJob } from 'cron';
import { ContentPipelineEntity } from './entities/content-pipeline.entity';
import { PipelineService } from './services/pipeline.service';
import { CRON_TIMEZONE, parseCronExpression } from '../common/cron.util';

/** 单条管线的调度状态（暴露给 admin：启用着却不跑时，一眼看出是 cron 坏了还是被停用） */
export interface SchedulerJobState {
  code: string;
  cron: string;
  registered: boolean;
  /** 下次执行时间（ISO 8601，+08:00）；注册失败为 null */
  nextRun: string | null;
  /** 注册失败原因；成功为 null */
  error: string | null;
}

export interface SchedulerStatus {
  timezone: string;
  checkedAt: string;
  total: number;
  failed: number;
  jobs: SchedulerJobState[];
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly jobs = new Map<string, CronJob>();
  /**
   * 注册结果快照。
   *
   * 2026-11-06（#8557）：注册失败曾只 `logger.error` 一行，进程照常起来、`/health` 照常 200，
   * 于是「管线停摆 2 天」无人发现。现在把结果留成可查询状态，并额外打一条 `[ALERT]` 汇总日志——
   * 日志给运维 grep，接口给 admin 页面显示，两条腿都要有。
   */
  private readonly state = new Map<string, SchedulerJobState>();

  constructor(
    @InjectRepository(ContentPipelineEntity)
    private readonly pipelineRepo: Repository<ContentPipelineEntity>,
    private readonly pipelineService: PipelineService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  onModuleDestroy(): void {
    this.stopAll();
  }

  /** 当前调度状态（admin 只读展示） */
  getStatus(): SchedulerStatus {
    const jobs = [...this.state.values()].sort((a, b) => a.code.localeCompare(b.code));
    return {
      timezone: CRON_TIMEZONE,
      checkedAt: new Date().toISOString(),
      total: jobs.length,
      failed: jobs.filter((j) => !j.registered).length,
      jobs,
    };
  }

  /**
   * 全量重注册。
   *
   * 启动时调一次；admin 改完 cron / enabled 也调一次——否则「改了要重启才生效」，
   * 而重启是可遇不可求的（本次故障正是改完隔了两天、因重启才暴露）。
   */
  async reload(): Promise<SchedulerStatus> {
    this.stopAll();
    this.state.clear();

    const pipelines = await this.pipelineRepo.find({ where: { enabled: true } });
    for (const p of pipelines) {
      const parsed = parseCronExpression(p.cron);
      if (!parsed.ok) {
        // 库里已有脏数据（历史遗留或直接改库）：不阻断启动，但必须留下可查的失败态
        this.state.set(p.code, {
          code: p.code,
          cron: p.cron,
          registered: false,
          nextRun: null,
          error: parsed.error ?? 'cron 无法解析',
        });
        this.logger.error(`注册调度失败 ${p.code}: ${parsed.error ?? 'cron 无法解析'}`);
        continue;
      }
      try {
        const job = new CronJob(
          parsed.normalized,
          () => {
            this.pipelineService
              .run(p.code)
              .catch((e) => this.logger.error(`调度执行失败 ${p.code}: ${(e as Error).message}`));
          },
          null,
          false,
          CRON_TIMEZONE,
        );
        job.start();
        this.jobs.set(p.code, job);
        this.state.set(p.code, {
          code: p.code,
          cron: parsed.normalized,
          registered: true,
          nextRun: parsed.nextRun ?? null,
          error: null,
        });
        this.logger.log(
          `已注册调度 ${p.code}（cron=${parsed.normalized}，下次 ${parsed.nextRun ?? '未知'}）`,
        );
      } catch (e) {
        const msg = (e as Error).message;
        this.state.set(p.code, {
          code: p.code,
          cron: parsed.normalized,
          registered: false,
          nextRun: null,
          error: msg,
        });
        this.logger.error(`注册调度失败 ${p.code}: ${msg}`);
      }
    }

    if (pipelines.length === 0) {
      this.logger.warn('无启用的内容管线，调度器空转（可先 seed content_pipelines）');
    }

    const status = this.getStatus();
    if (status.failed > 0) {
      const detail = status.jobs
        .filter((j) => !j.registered)
        .map((j) => `${j.code}(cron=${j.cron}) → ${j.error}`)
        .join('；');
      this.logger.error(
        `[ALERT] 调度注册失败 ${status.failed}/${status.total} 条，以下管线不会按时运行：${detail}`,
      );
    }
    return status;
  }

  private stopAll(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();
  }
}
