import { randomBytes } from 'crypto';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalModule } from '../approval/approval.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DeployApprovalEntity } from '../entities/deploy-approval.entity';
import { PipelineModule } from '../pipeline/pipeline.module';
import { WecomApiClient } from './wecom-api.client';
import { WecomApprovalService } from './wecom-approval.service';
import { WecomApproveGuard } from './wecom-approve.guard';
import { WecomConfigService, resolveWecomConfig } from './wecom.config';
import { WecomController } from './wecom.controller';
import { WecomIdentityClient } from './wecom-identity.client';
import { WecomNotifierService } from './wecom-notifier.service';
import { WecomSessionService } from './wecom-session.service';
import { WecomTicketService } from './wecom-ticket.service';

/**
 * 企微审批通道（卡②）。
 *
 * 开关关闭时仍注册模块（V12「完全回到现状」靠 config 早退 + notifier 不订阅），
 * 但票据密钥用**进程内随机值**：即使有路由被误调也签不出可用短令牌。
 *
 * 启动自检：`resolveWecomConfig()` 在 ENABLED=1 且缺 CONSOLE_PUBLIC_BASE_URL /
 * 凭证时抛错 → 服务起不来，而不是发出指向本机的死链。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DeployApprovalEntity]),
    ApprovalModule,
    PipelineModule,
    AuditModule,
    // 只为拿 JwtService 签「票据换平台会话」（WecomSessionService）。
    // AuthModule 已在 AppModule 里 import，Nest 复用同一模块实例，不会重复注册全局守卫。
    AuthModule,
  ],
  controllers: [WecomController],
  providers: [
    WecomConfigService,
    {
      provide: WecomTicketService,
      useFactory: (cfg: WecomConfigService) => {
        const env = resolveWecomConfig(process.env);
        return new WecomTicketService(env.enabled ? cfg.config.ticketSecret : randomBytes(32).toString('hex'));
      },
      inject: [WecomConfigService],
    },
    WecomApiClient,
    WecomIdentityClient,
    WecomNotifierService,
    WecomApprovalService,
    WecomSessionService,
    WecomApproveGuard,
  ],
  exports: [WecomNotifierService],
})
export class WecomModule {}
