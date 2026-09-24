/**
 * 邮箱验证码：发送（限频）+ 校验（限次）
 *
 * 设计见 specs/kedou-ai-minigram/design-mp-account.md §5.9：
 * - 复用 ApiKeyService 的验证码思路与 MailService 的 SMTP 通道
 * - 与 MCP API Key 的差异：本服务落库（email_verification_codes）、带发送限频、未配置 SMTP 显式 503
 * - 绑定邮箱的**落库与合并**不在这里，由 auth-service 统一处理（合并只有一套）
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, IsNull } from 'typeorm';
import * as crypto from 'crypto';
import { EmailVerificationCodeEntity } from './entities/email-verification-code.entity';
import { MailService } from '../api-key/mail.service';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectRepository(EmailVerificationCodeEntity)
    private readonly repo: Repository<EmailVerificationCodeEntity>,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 发送验证码。
   * 限频：60s 重发冷却；同一邮箱 10 分钟 ≤5 次。
   * 未配置 SMTP → 503（不做静默兜底，避免「以为发了其实没发」）。
   */
  async sendCode(email: string, userId: number | null, purpose = 'bind'): Promise<{ message: string }> {
    const to = String(email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(to)) throw new BadRequestException('邮箱格式不正确');

    // 环境变量缺失时回退读 system_configs 的 notify_smtp_*（admin「通知设置 → 邮件通知」）
    if (!(await this.mail.isEnabled())) {
      throw new HttpException('邮件服务暂不可用，请稍后再试', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const resendInterval = Number(this.config.get('EMAIL_CODE_RESEND_INTERVAL', 60));
    const windowLimit = Number(this.config.get('EMAIL_CODE_WINDOW_LIMIT', 5));

    const latest = await this.repo.findOne({ where: { email: to }, order: { createdAt: 'DESC' } });
    if (latest) {
      const since = Date.now() - new Date(latest.createdAt).getTime();
      if (since < resendInterval * 1000) {
        const wait = Math.ceil((resendInterval * 1000 - since) / 1000);
        throw new HttpException(`请 ${wait} 秒后再试`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const windowStart = new Date(Date.now() - 10 * 60 * 1000);
    const recent = await this.repo.count({ where: { email: to, createdAt: MoreThan(windowStart) } });
    if (recent >= windowLimit) {
      throw new HttpException('发送过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const ttl = Number(this.config.get('EMAIL_CODE_TTL', 300));
    const entity = this.repo.create({
      email: to,
      userId: userId ?? null,
      codeHash: crypto.createHash('sha256').update(code).digest('hex'),
      purpose,
      expiresAt: new Date(Date.now() + ttl * 1000),
      attempts: 0,
    });
    await this.repo.save(entity);

    try {
      await this.mail.sendMail({
        to,
        subject: '科豆 AI — 绑定邮箱验证码',
        text: `你的验证码是 ${code}，${Math.floor(ttl / 60)} 分钟内有效。如非本人操作请忽略。`,
        html: `<p>你正在绑定科豆 AI 邮箱，验证码是 <b style="font-size:18px">${code}</b>，${Math.floor(ttl / 60)} 分钟内有效。</p>
               <p style="color:#999">如非本人操作，请忽略此邮件。</p>`,
      });
    } catch (err: any) {
      // 发送失败：删掉已落库的码，避免占用限频额度
      await this.repo.remove(entity).catch(() => null);
      this.logger.warn(`验证码邮件发送失败: ${err?.message || err}`);
      throw new HttpException('邮件发送失败，请稍后再试', HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { message: `验证码已发送至 ${to}，请查收` };
  }

  /**
   * 发送测试邮件（admin「系统设置 → 通知设置 → 发送测试邮件」）。
   * 先强制重读配置，保证测的就是刚保存的那份。
   */
  async sendTestMail(to: string): Promise<{ message: string }> {
    const target = String(to || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      throw new BadRequestException('收件邮箱格式不正确');
    }
    await this.mail.refresh();
    if (!(await this.mail.isEnabled())) {
      throw new HttpException('邮件服务暂不可用，请先保存 SMTP 配置', HttpStatus.SERVICE_UNAVAILABLE);
    }
    try {
      await this.mail.sendMail({
        to: target,
        subject: '科豆 AI — 测试邮件',
        text: '这是一封来自科豆 AI 系统设置的测试邮件，收到即表示邮件服务配置正确。',
        html: `<p>这是一封来自科豆 AI 系统设置的测试邮件。</p>
               <p style="color:#999">收到即表示邮件服务配置正确。</p>`,
      });
    } catch (err: any) {
      this.logger.warn(`测试邮件发送失败: ${err?.message || err}`);
      throw new HttpException('测试邮件发送失败，请检查 SMTP 配置', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { message: `测试邮件已发送至 ${target}，请查收` };
  }

  /**
   * 校验并核销验证码（内部端点用）。
   * 单码最多校验 5 次，超过即作废；成功后置 used_at，不可复用。
   */
  async verify(email: string, code: string, userId?: number): Promise<{ ok: true }> {
    const to = String(email || '').trim().toLowerCase();
    const input = String(code || '').trim();
    if (!EMAIL_RE.test(to) || !/^\d{6}$/.test(input)) {
      throw new BadRequestException('邮箱或验证码格式不正确');
    }

    const record = await this.repo.findOne({
      where: { email: to, usedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!record) throw new BadRequestException('验证码错误或已过期');
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException('验证码已过期，请重新获取');
    }

    const maxAttempts = Number(this.config.get('EMAIL_CODE_MAX_ATTEMPTS', 5));
    if (record.attempts >= maxAttempts) {
      throw new BadRequestException('验证码错误次数过多，请重新获取');
    }

    const hash = crypto.createHash('sha256').update(input).digest('hex');
    if (hash !== record.codeHash) {
      record.attempts += 1;
      await this.repo.save(record);
      throw new BadRequestException('验证码错误');
    }

    record.usedAt = new Date();
    await this.repo.save(record);
    this.logger.log(`邮箱验证码核销成功: email=${to} userId=${userId ?? '-'}`);
    return { ok: true };
  }
}
