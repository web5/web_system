/** 内容管线调度器——启动时读 content_pipelines.cron 动态注册定时任务 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CronJob } from 'cron';
import { ContentPipelineEntity } from './entities/content-pipeline.entity';
import { PipelineService } from './services/pipeline.service';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly jobs: CronJob[] = [];

  constructor(
    @InjectRepository(ContentPipelineEntity)
    private readonly pipelineRepo: Repository<ContentPipelineEntity>,
    private readonly pipelineService: PipelineService,
  ) {}

  async onModuleInit(): Promise<void> {
    const pipelines = await this.pipelineRepo.find({ where: { enabled: true } });
    for (const p of pipelines) {
      try {
        const job = new CronJob(
          p.cron,
          () => {
            this.pipelineService
              .run(p.code)
              .catch((e) => this.logger.error(`调度执行失败 ${p.code}: ${(e as Error).message}`));
          },
          null,
          false,
          'Asia/Shanghai',
        );
        job.start();
        this.jobs.push(job);
        this.logger.log(`已注册调度 ${p.code}（cron=${p.cron}）`);
      } catch (e) {
        this.logger.error(`注册调度失败 ${p.code}: ${(e as Error).message}`);
      }
    }
    if (pipelines.length === 0) {
      this.logger.warn('无启用的内容管线，调度器空转（可先 seed content_pipelines）');
    }
  }

  onModuleDestroy(): void {
    this.jobs.forEach((j) => j.stop());
  }
}
