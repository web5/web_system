import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 启动期 CONSOLE_INSTANCE 自检
 *
 * 口径（docs/development/console-monitor-followups.md §4.4 b2，用户 2026-09-24 明确）：
 * **不做默认回落** —— 缺失即 FATAL + exit(1)。
 * 原因：页签口径（哪些环境可管）由它决定，静默回落会让 dev 控制台冒出「本地」页签，
 * 属"看起来能用其实是错的"隐性故障。与 CONFIG_MASTER_KEY 同规格（启动即报）。
 */
@Injectable()
export class ConsoleInstanceSelfCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ConsoleInstanceSelfCheck');

  constructor(private readonly configService: ConfigService) {}

  onApplicationBootstrap(): void {
    const v = (this.configService.get<string>('CONSOLE_INSTANCE') || '').trim();
    if (!v) {
      this.logger.error(
        'FATAL CONSOLE_INSTANCE 未配置：请在本控制台的 .env 写入实例标识（orchestrator / dev / …）后重启',
      );
      this.logger.error(
        '说明：它决定监控页展示哪些环境（主机管理里 managed_by 为空或匹配该标识的主机所支撑的环境），无默认值。',
      );
      process.exit(1);
    }
    this.logger.log(`CONSOLE_INSTANCE=${v}`);
  }
}
