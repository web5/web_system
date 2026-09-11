import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { DeployReleaseEventEntity } from '../entities/deploy-release-event.entity';
import { PipelineService, SubmitPipelineDto } from '../pipeline/pipeline.service';
import { ReleaseHookDto } from './release-hook.dto';

/** 签名头（与 GitHub Webhook 同名，便于复用生态习惯） */
export const SIGNATURE_HEADER = 'x-hub-signature-256';
/** 时间戳头（参与签名，防重放） */
export const TIMESTAMP_HEADER = 'x-ws-timestamp';
/** 允许的时间戳偏移（秒）：超出即视为重放 */
export const MAX_SKEW_SEC = 300;

export interface ReleaseHookResult {
  deliveryId: string;
  duplicate: boolean;
  jobId: string | null;
  status: string;
  approvalId?: string;
}

/**
 * 供 CI 轮询的流水线状态快照。
 *
 * 刻意**不含** `logs` / `result` / `error` 细节中的路径信息 / 注入变量：
 * CI 只需要"成功-失败-进行中"与当前阶段，其余属平台内部信息。
 */
export interface HookPipelineStatus {
  jobId: string;
  status: string;
  stage?: string;
  moduleKey: string;
  env: string;
  versionTag?: string;
  /** 当前阶段进度文案（如「构建中 2/3」） */
  message: string;
  /** 终态时间（毫秒时间戳） */
  endTime?: number;
}

/**
 * CI/CD 发布触发与状态查询服务。
 *
 * 定位：只做「接收发布意图 → 鉴权 → 幂等 → 转交流水线」+「只读状态查询」，
 * **不包含任何执行逻辑** —— 执行仍由 `PipelineService.submit` 统一入口承担，
 * 使 CI 触发与控制台、MCP 三条入口共享同一套锁 / 审批 / 审计 / 回滚语义。
 *
 * 安全：
 * - HMAC-SHA256 签名（`sha256=hex(hmac(secret, `${ts}.${rawBody}`))`），常量时间比较
 * - 时间戳参与签名并校验偏移窗口，防重放
 * - `deliveryId` 唯一键幂等，重复投递不产生第二条流水线
 */
@Injectable()
export class ReleaseHookService {
  private readonly logger = new Logger(ReleaseHookService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(DeployReleaseEventEntity)
    private readonly events: Repository<DeployReleaseEventEntity>,
    private readonly pipeline: PipelineService,
  ) {}

  /**
   * 校验签名与时间戳。验签对象是**原始请求体**（不是重新序列化的 JSON），
   * 否则键顺序/空白差异会导致签名永远不匹配。
   */
  verifySignature(rawBody: string, signature?: string, timestamp?: string): void {
    const secret = this.config.get<string>('RELEASE_HOOK_SECRET');
    if (!secret) {
      throw new UnauthorizedException('未配置 RELEASE_HOOK_SECRET，触发端点不可用');
    }
    if (!signature || !timestamp) {
      throw new UnauthorizedException(`缺少 ${SIGNATURE_HEADER} 或 ${TIMESTAMP_HEADER}`);
    }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      throw new UnauthorizedException('时间戳非法');
    }
    const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (skew > MAX_SKEW_SEC) {
      throw new UnauthorizedException(
        `时间戳超出允许窗口（${MAX_SKEW_SEC}s），疑似重放`,
      );
    }

    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new UnauthorizedException('签名校验失败');
    }
  }

  /** 解析并校验 payload（失败抛 400，附具体字段错误） */
  async parse(rawBody: string): Promise<ReleaseHookDto> {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('请求体不是合法 JSON');
    }
    const dto = plainToInstance(ReleaseHookDto, json ?? {});
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
    if (errors.length) {
      const msg = errors
        .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join('; ')}`)
        .join(' | ');
      throw new BadRequestException(`发布意图校验失败 → ${msg}`);
    }
    return dto;
  }

  /** 幂等受理：同一 deliveryId 只提交一次流水线 */
  async handle(dto: ReleaseHookDto, rawBody: string): Promise<ReleaseHookResult> {
    const existed = await this.events.findOne({ where: { deliveryId: dto.deliveryId } });
    if (existed) {
      this.logger.log(
        `重复投递已忽略: ${dto.deliveryId} → 原流水线 ${existed.pipelineId ?? '（无）'}`,
      );
      return {
        deliveryId: dto.deliveryId,
        duplicate: true,
        jobId: existed.pipelineId ?? null,
        status: existed.status,
      };
    }

    const source = dto.source || 'unknown-workflow';
    const ev = this.events.create({
      deliveryId: dto.deliveryId,
      event: dto.event || 'push',
      source,
      env: dto.env,
      moduleKey: dto.moduleKey,
      status: 'rejected',
      payload: this.safePayload(rawBody),
    });

    try {
      const submitDto: SubmitPipelineDto = {
        env: dto.env,
        moduleKey: dto.moduleKey,
        branch: dto.branch,
        commitId: dto.commitId,
        mode: (dto.mode as SubmitPipelineDto['mode']) ?? 'direct',
        target: dto.target as SubmitPipelineDto['target'],
      };
      // operator 统一为 ci:<source>，禁止落到 mcp/anonymous/unknown
      const r = await this.pipeline.submit(submitDto, `ci:${source}`);
      ev.pipelineId = r.jobId;
      ev.status = 'accepted';
      await this.events.save(ev);
      this.logger.log(
        `受理 CI 发布: ${dto.moduleKey}@${dto.env} → 流水线 ${r.jobId}（${r.status}）`,
      );
      return {
        deliveryId: dto.deliveryId,
        duplicate: false,
        jobId: r.jobId,
        status: r.status,
        approvalId: r.approvalId,
      };
    } catch (e) {
      ev.reason = (e as Error).message.slice(0, 500);
      await this.events.save(ev).catch(() => undefined);
      throw e;
    }
  }

  /**
   * 查询流水线状态（供 CI 轮询至终态）。
   *
   * 为什么不让 CI 拿控制台 JWT 轮询：控制台 token 是 `expiresIn: 24h` 的**短期登录态**，
   * 存进 CI secrets 次日即 401（轮询静默失效、发布卡住）；且该 token 权限覆盖
   * 发布/取消/审批，给 CI 等于放大凭据面。此处复用触发端的 hook 密钥做 HMAC 验签：
   * 不过期、不新增凭据、权限恰好只够"看状态"。
   */
  async pipelineStatus(jobId: string): Promise<HookPipelineStatus> {
    const p = await this.pipeline.get(jobId);
    return {
      jobId: p.id,
      status: p.status,
      stage: p.stage,
      moduleKey: p.moduleKey,
      env: p.env,
      versionTag: p.versionTag,
      message: p.progress?.message ?? '',
      endTime: p.endTime,
    };
  }

  /** payload 落库前裁剪：避免超长或意外携带敏感信息 */
  private safePayload(rawBody: string): Record<string, unknown> {
    try {
      const j = JSON.parse(rawBody) as Record<string, unknown>;
      const trimmed = JSON.stringify(j).slice(0, 4000);
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
