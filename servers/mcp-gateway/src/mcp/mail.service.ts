import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * 申请验证码邮件发送（通用 SMTP）
 * 配置：SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
 * 未配置 SMTP_HOST 时 enabled=false，申请接口返回 503
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private configService: ConfigService) {
    const host = this.configService.get('SMTP_HOST');
    if (host) {
      const port = Number(this.configService.get('SMTP_PORT', 465));
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: {
          user: this.configService.get('SMTP_USER'),
          pass: this.configService.get('SMTP_PASS'),
        },
      });
      this.logger.log(`SMTP 已启用: ${host}:${port}`);
    } else {
      this.logger.warn('SMTP_HOST 未配置，邮件发送不可用（/api/keys 申请将返回 503）');
    }
  }

  get enabled(): boolean {
    return !!this.transporter;
  }

  async sendCode(email: string, code: string): Promise<void> {
    if (!this.transporter) throw new Error('SMTP_NOT_CONFIGURED');
    const from = this.configService.get('SMTP_FROM', this.configService.get('SMTP_USER'));
    await this.transporter.sendMail({
      from,
      to: email,
      subject: '科豆财经资讯 MCP — 你的 API Key 验证码',
      text: `你的验证码是 ${code}，10 分钟内有效。如非本人操作请忽略。`,
      html: `<p>你的验证码是 <b style="font-size:18px">${code}</b>，10 分钟内有效。</p>
             <p style="color:#999">如非本人操作，请忽略此邮件。</p>`,
    });
  }
}
