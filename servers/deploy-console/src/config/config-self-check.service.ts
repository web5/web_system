import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigItemEntity } from '../entities/config-item.entity';
import { decryptSecret, masterKeyFingerprint, masterKeySource } from './config-crypto';

/**
 * 启动期主密钥自检（design §5.2）。
 *
 * 目的：把"某次读配置才炸"变成"启动即报"——
 *  · 密钥缺失 / 文件读不到 / env 与文件不一致 → FATAL + exit(1)（仅当库里确有密钥项）；
 *  · 抽样解密失败（GCM 认证失败）→ FATAL + exit(1)，明确提示"主密钥与本库不匹配"；
 *  · 配置库暂不可达 → 只告警，保持既有启动行为（避免 DB 抖动导致服务反复被杀）；
 *  · 库里暂无密钥项 → 放行并注明（新环境/空库不该被硬拦）。
 */
@Injectable()
export class ConfigSelfCheckService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ConfigSelfCheck');

  constructor(
    @InjectRepository(ConfigItemEntity)
    private readonly items: Repository<ConfigItemEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let sample: ConfigItemEntity | null;
    try {
      // 抽检任意一条启用中的密钥项即可（顺序无关）
      sample = await this.items.findOne({ where: { isSecret: true, enabled: true } });
    } catch (e) {
      this.logger.warn(`主密钥自检跳过：配置库暂不可达（${(e as Error).message}）`);
      return;
    }

    if (!sample) {
      try {
        const fp = masterKeyFingerprint();
        const src = masterKeySource();
        this.logger.log(
          `主密钥就绪 fp=${fp} source=${src.source}${src.filePath ? ` file=${src.filePath}` : ''} 抽样可解=0/0（库中暂无密钥项）`,
        );
      } catch (e) {
        this.logger.warn(
          `主密钥自检：配置库暂无 is_secret 项，且当前未配置可用主密钥（${(e as Error).message}）—— 新增密钥项前必须先完成主密钥配置`,
        );
      }
      return;
    }

    let fp: string;
    let src: { source: string; filePath?: string };
    try {
      fp = masterKeyFingerprint();
      src = masterKeySource();
    } catch (e) {
      this.fatal(`主密钥不可用：${(e as Error).message}`);
      return;
    }

    try {
      decryptSecret(sample.value);
    } catch (e) {
      this.fatal(
        `主密钥与本库不匹配：抽样解密 ${sample.scope}/${sample.envId || '-'}/${sample.moduleKey || '-'}/${sample.key} 失败（${(e as Error).message}）`,
      );
      return;
    }

    this.logger.log(
      `主密钥就绪 fp=${fp} source=${src.source}${src.filePath ? ` file=${src.filePath}` : ''} 抽样可解=1/1`,
    );
  }

  /** 启动即失败：日志可 grep `FATAL`，pm2 连续失败后置 errored，发布 verify 探活也会标红 */
  private fatal(message: string): void {
    this.logger.error(`FATAL ${message}`);
    this.logger.error(
      '修复：① 确认本机密钥与目标部署库同域（specs/config-master-key-distribution/design.md §2）；' +
        '② 跑 scripts/verify-config-master-key.mjs 定位是哪一侧不对；' +
        '③ 换库/拆域场景按 domain-split-guide.md 处理。',
    );
    process.exit(1);
  }
}
