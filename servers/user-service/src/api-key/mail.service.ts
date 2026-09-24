import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as nodemailer from 'nodemailer';

/**
 * 邮件发送（通用 SMTP）
 *
 * 配置来源两级：
 * 1) 环境变量 `SMTP_HOST/PORT/USER/PASS/FROM`（部署口径，优先）
 * 2) 环境变量缺失时**回退读** `system_configs` 的 `notify_smtp_*`
 *    —— 即 admin「系统设置 → 通知设置 → 邮件通知」写入的那份。
 *    此前该页面写了没人读（死配置），本改动让它真正生效；缓存 60s。
 *
 * 两者都没有 → `SMTP_NOT_CONFIGURED`，调用方按 503 处理（不做静默兜底）。
 */
interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  pass: string;
  from: string;
  source: 'env' | 'db';
}

const SMTP_DB_KEYS = [
  'notify_smtp_host',
  'notify_smtp_port',
  'notify_smtp_encryption',
  'notify_smtp_from',
  'notify_smtp_pass',
];
/** 库配置缓存：避免每封邮件都查库 */
const DB_CONFIG_TTL_MS = 60_000;

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private envTransporter: nodemailer.Transporter | null = null;
  private dbConfig: SmtpConfig | null = null;
  private dbTransporter: nodemailer.Transporter | null = null;
  private dbLoadedAt = 0;

  constructor(
    private configService: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    const host = this.configService.get('SMTP_HOST');
    if (host) {
      const port = Number(this.configService.get('SMTP_PORT', 465));
      this.envTransporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user: this.configService.get('SMTP_USER'),
          pass: this.configService.get('SMTP_PASS'),
        },
      });
      this.logger.log(`SMTP 已启用（环境变量）: ${host}:${port}`);
    }
  }

  async onModuleInit() {
    // 预热：环境变量未配时先探一次库配置，失败不阻塞启动
    if (this.envTransporter) return;
    await this.loadDbConfig(true).catch(() => null);
  }

  /** 同步 getter：仅表示「环境变量已配置」（兼容既有调用点） */
  get enabled(): boolean {
    return !!this.envTransporter;
  }

  /** 是否可用（含回退读库） */
  async isEnabled(): Promise<boolean> {
    return !!(await this.resolve());
  }

  /**
   * 强制重读库配置（清缓存）。
   * admin 保存「通知设置」后立即点「发送测试邮件」时用：否则会命中 60s 旧缓存，
   * 测到的是保存前的配置（表象：刚配好却提示未配置）。
   */
  async refresh(): Promise<void> {
    if (this.envTransporter) return;
    await this.loadDbConfig(true);
  }

  /** 通用发送（未配置抛 SMTP_NOT_CONFIGURED，调用方按 503 处理） */
  async sendMail(input: { to: string; subject: string; text: string; html: string }): Promise<void> {
    const resolved = await this.resolve();
    if (!resolved) throw new Error('SMTP_NOT_CONFIGURED');
    await resolved.transporter.sendMail({ from: resolved.from, ...input });
  }

  async sendCode(email: string, code: string): Promise<void> {
    return this.sendMail({
      to: email,
      subject: '科豆 AI — 你的 API Key 验证码',
      text: `你的验证码是 ${code}，10 分钟内有效。如非本人操作请忽略。`,
      html: `<p>你的验证码是 <b style="font-size:18px">${code}</b>，10 分钟内有效。</p>
             <p style="color:#999">如非本人操作，请忽略此邮件。</p>`,
    });
  }

  private async resolve(): Promise<{ transporter: nodemailer.Transporter; from: string } | null> {
    if (this.envTransporter) {
      const from = this.configService.get('SMTP_FROM') || this.configService.get('SMTP_USER') || '';
      return { transporter: this.envTransporter, from };
    }
    const cfg = await this.loadDbConfig();
    if (!cfg || !this.dbTransporter) return null;
    return { transporter: this.dbTransporter, from: cfg.from };
  }

  /** 从 system_configs 读 notify_smtp_*（admin 通知设置写入处），带 60s 缓存 */
  private async loadDbConfig(force = false): Promise<SmtpConfig | null> {
    const now = Date.now();
    if (!force && this.dbConfig && now - this.dbLoadedAt < DB_CONFIG_TTL_MS) {
      return this.dbConfig;
    }
    try {
      const rows = (await this.dataSource.query(
        `SELECT \`key\`, \`value\` FROM system_configs WHERE \`key\` IN (${SMTP_DB_KEYS
          .map(() => '?')
          .join(',')}) AND deleted_at IS NULL`,
        SMTP_DB_KEYS,
      )) as Array<{ key: string; value: string }>;

      const map = new Map(rows.map((r) => [r.key, String(r.value ?? '').trim()]));
      const host = map.get('notify_smtp_host') || '';
      const pass = map.get('notify_smtp_pass') || '';
      if (!host || !pass) {
        this.dbConfig = null;
        this.dbTransporter = null;
        this.dbLoadedAt = now;
        return null;
      }

      const port = Number(map.get('notify_smtp_port') || 465) || 465;
      const encryption = (map.get('notify_smtp_encryption') || 'ssl').toLowerCase();
      const from = map.get('notify_smtp_from') || this.configService.get('SMTP_USER') || '';
      const cfg: SmtpConfig = {
        host,
        port,
        secure: encryption === 'ssl',
        // TLS 走 STARTTLS：端口通常 587，secure 必须为 false
        requireTLS: encryption === 'tls',
        // admin 表单没有「用户名」字段，发件人邮箱即登录账号
        user: from,
        pass,
        from: from || host,
        source: 'db',
      };

      this.dbTransporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        requireTLS: cfg.requireTLS || undefined,
        auth: { user: cfg.user, pass: cfg.pass },
      });
      this.dbConfig = cfg;
      this.dbLoadedAt = now;
      this.logger.log(`SMTP 已启用（系统配置）: ${cfg.host}:${cfg.port} encryption=${encryption}`);
      return cfg;
    } catch (err: any) {
      this.logger.warn(`读取系统 SMTP 配置失败: ${err?.message || err}`);
      this.dbConfig = null;
      this.dbTransporter = null;
      this.dbLoadedAt = now;
      return null;
    }
  }
}
