import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeployPipelineEntity } from '../entities/deploy-pipeline.entity';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { DeployPipelineTemplateEntity } from '../entities/deploy-pipeline-template.entity';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';
// 内置步骤执行器（每个步骤的执行体独立为类，注入各自工具）
import { CheckExecutor } from './steps/check.executor';
import { PullExecutor } from './steps/pull.executor';
import { UploadExecutor } from './steps/upload.executor';
import { RestartExecutor } from './steps/restart.executor';
import { VersionExecutor } from './steps/version.executor';
import { PointerExecutor } from './steps/pointer.executor';
import { VerifyExecutor } from './steps/verify.executor';
import { CleanupExecutor } from './steps/cleanup.executor';
import { PIPELINE_BUILTIN_STEPS, buildBuiltinSteps, BuiltinExecutors } from './steps/step-registry';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { CanaryModule } from '../canary/canary.module';
import { AuditModule } from '../audit/audit.module';
import { DeployModule } from '../deploy/deploy.module';
import { StageCommandModule } from '../stage-command/stage-command.module';
import { ConfigCenterModule } from '../config/config.module';
import { ReleaseLockModule } from '../release-lock/release-lock.module';
import { NotificationModule } from '../notification/notification.module';
import { ApprovalModule } from '../approval/approval.module';
import { PipelineTemplateModule } from '../pipeline-template/pipeline-template.module';
import { ProbeModule } from '../probe/probe.module';
import { Pm2Module } from '../pm2/pm2.module';
import { ShellModule } from '../shell/shell.module';
import { ReleaseGitModule } from '../git/release-git.module';
import { ArtifactStoreModule } from '../artifact/artifact-store.module';
import { ReleaseRegistryModule } from '../registry/release-registry.module';
import { RemoteDeliveryModule } from '../remote/remote-delivery.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeployPipelineEntity,
      DeployVersionEntity,
      DeployDeploymentEntity,
      DeployPipelineTemplateEntity,
    ]),
    ModuleRegistryModule,
    CanaryModule,
    AuditModule,
    // 复用 DeployService 的版本查询能力（可发布版本列表）
    DeployModule,
    // 阶段命令（每模块每阶段一条 shell，DB 为真相源）
    StageCommandModule,
    // 配置中心（发布/重启时按作用域合并并强制覆盖注入进程环境）
    ConfigCenterModule,
    // 发布锁（同一模块×环境串行化，避免并发覆盖版本指针）
    ReleaseLockModule,
    // 通知中心（发布成功/失败/自动回滚事件推送）
    NotificationModule,
    // 审批门禁（需审批环境默认 prod：提交阻断，审批通过后执行）
    ApprovalModule,
    // 流水线模板（提交解析模板 + 落实例快照）
    PipelineTemplateModule,
    // HTTP 探活工具（verify manifest 断言 / 后端端口探活 / 产物 HEAD 检查）
    ProbeModule,
    // pm2 进程健康探活（verify 后端探活 / restart 查名 / 回滚后探活）
    Pm2Module,
    // 命令执行（同步 exec + PATH + bin 解析）
    ShellModule,
    // 发布目录 git 工作区（pull 执行体）
    ReleaseGitModule,
    // 静态产物存储（upload/cleanup 执行体）
    ArtifactStoreModule,
    // 版本注册表（version/pointer 执行体）
    ReleaseRegistryModule,
    // 远程投递（upload remote 执行体）
    RemoteDeliveryModule,
  ],
  controllers: [PipelineController],
  providers: [
    PipelineService,
    // 内置步骤执行体（独立注入工具，engine 不感知实现细节）
    CheckExecutor,
    PullExecutor,
    UploadExecutor,
    RestartExecutor,
    VersionExecutor,
    PointerExecutor,
    VerifyExecutor,
    CleanupExecutor,
    // 步骤注册表：按步骤元数据（category/commandMode/守卫/执行体）组装，engine 数据驱动分派
    {
      provide: PIPELINE_BUILTIN_STEPS,
      useFactory: (
        check: CheckExecutor,
        pull: PullExecutor,
        upload: UploadExecutor,
        restart: RestartExecutor,
        version: VersionExecutor,
        pointer: PointerExecutor,
        verify: VerifyExecutor,
        cleanup: CleanupExecutor,
      ) =>
        buildBuiltinSteps({ check, pull, upload, restart, version, pointer, verify, cleanup } as BuiltinExecutors),
      inject: [
        CheckExecutor,
        PullExecutor,
        UploadExecutor,
        RestartExecutor,
        VersionExecutor,
        PointerExecutor,
        VerifyExecutor,
        CleanupExecutor,
      ],
    },
  ],
  exports: [PipelineService],
})
export class PipelineModule {}
