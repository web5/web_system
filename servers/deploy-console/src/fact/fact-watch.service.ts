import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FactCollectService, FactBatchReport } from './fact-collect.service';

/** 默认巡检间隔（可配 `FACT_SNAPSHOT_INTERVAL_MS`，0 = 关闭定时，仍可手动触发） */
export const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 首次巡检延迟：别让启动瞬间就往外连一堆机器 */
const DEFAULT_FIRST_DELAY_MS = 60 * 1000;

/**
 * 事实巡检定时驱动（Fact 层 v1 的调度面）。
 *
 * 刻意**不引 `@nestjs/schedule`**：一个 interval 就够（与 `ConsistencyWatchService`
 * 同一取舍，那边注释已说明），为一个定时任务加依赖不划算。
 *
 * 默认只采 `dev`：`prod` 必须显式写进 `FACT_SNAPSHOT_ENVS` —— 采集要往目标机执行
 * 命令，即便全部只读，也应当是人明确开过的。
 */
@Injectable()
export class FactWatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FactWatchService.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private firstTimer: ReturnType<typeof setTimeout> | undefined;
  private last: FactBatchReport[] = [];

  constructor(
    private readonly cfg: ConfigService,
    private readonly collect: FactCollectService,
  ) {}

  onModuleInit(): void {
    if ((this.cfg.get<string>('FACT_SNAPSHOT_ENABLED') ?? 'true') === 'false') {
      this.logger.log('事实巡检已关闭（FACT_SNAPSHOT_ENABLED=false）');
      return;
    }
    const raw = this.cfg.get<string>('FACT_SNAPSHOT_INTERVAL_MS');
    const interval =
      raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : DEFAULT_INTERVAL_MS;
    if (interval <= 0) {
      this.logger.log('事实巡检定时已关闭（FACT_SNAPSHOT_INTERVAL_MS=0），仍可手动触发');
      return;
    }

    const run = () => {
      void this.runAll().catch((e) => this.logger.error(`事实巡检异常：${(e as Error).message}`));
    };
    const delayMs =
      Number(this.cfg.get<string>('FACT_SNAPSHOT_FIRST_DELAY_MS')) || DEFAULT_FIRST_DELAY_MS;
    this.firstTimer = setTimeout(() => {
      run();
      this.timer = setInterval(run, interval);
      (this.timer as unknown as { unref?: () => void })?.unref?.();
    }, delayMs);
    (this.firstTimer as unknown as { unref?: () => void })?.unref?.();
    this.logger.log(
      `事实巡检已启用：每 ${Math.round(interval / 60000)} 分钟一次（首次 ${Math.round(
        delayMs / 1000,
      )}s 后，环境 ${this.collect.allowedEnvs().join(',') || '(空)'}）`,
    );
  }

  onModuleDestroy(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  /** 最近一批结果（供接口/排障查看） */
  lastReports(): FactBatchReport[] {
    return this.last;
  }

  /** 对所有允许的环境各采一次（定时与手动共用） */
  async runAll(): Promise<FactBatchReport[]> {
    const envs = this.collect.allowedEnvs();
    const out: FactBatchReport[] = [];
    for (const env of envs) {
      try {
        out.push(await this.collect.collect(env, 'schedule'));
      } catch (e) {
        this.logger.error(`事实巡检失败（env=${env}）：${(e as Error).message}`);
      }
    }
    this.last = out;
    return out;
  }
}
