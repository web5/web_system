import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { McpKeyGuard } from './mcp-key.guard';
import { ApproverService } from '../approval/approver.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { DeployService } from '../deploy/deploy.service';
import { ReleasePlanService } from '../release-plan/release-plan.service';
import { ReleasePlanDto } from '../release-plan/dto/release-plan.dto';
import { ReleaseVerifyService } from '../release-verify/release-verify.service';
import { ReleaseVerifyDto } from '../release-verify/dto/release-verify.dto';
import { ModuleRollbackDto } from './dto/module-rollback.dto';

/**
 * MCP 发布接口（/api/mcp/*）。
 *
 * 与控制台接口（/api/pipelines/*）的区别：
 *  - 鉴权走 McpKeyGuard（每用户 API Key → ownerId），而非控制台 JWT
 *  - 返回结构对齐任务语义（jobId / status / progress / logs），供 MCP 工具直接映射
 *  - mcp-gateway 是唯一 MCP 端点，这里只是它背后的执行接口
 *
 * 操作人一律取 `req.mcpOperator`（API Key 的 ownerId），保证审计可追溯到人。
 */
@ApiTags('MCP 发布接口')
@Controller('mcp')
@Public()
@UseGuards(McpKeyGuard)
export class McpController {
  /** dev-only mock 任务（验证长任务 T3 双模式用，避免每次真构建） */
  private readonly mockJobs = new Map<
    string,
    { status: string; startedAt: number; seconds: number }
  >();

  constructor(
    private readonly pipelineService: PipelineService,
    private readonly deployService: DeployService,
    private readonly approvers: ApproverService,
    private readonly releasePlanService: ReleasePlanService,
    private readonly releaseVerifyService: ReleaseVerifyService,
  ) {}

  private operator(req: any): string {
    return req?.mcpOperator || 'unknown';
  }

  /**
   * 把 MCP Key 的 `ownerId` 解析成**用户名**，供审批权限校验使用。
   *
   * 为什么必须解析：`ApproverService.canApprove()` 按**用户名字符串**与 user-service
   * 的授权清单比对，而 MCP Key 只带 `ownerId`（如 `1`）。不解析的话 ownerId 会被
   * 当成用户名去比对，必然 403 —— 自动化审批永远过不去。
   *
   * 解析不到时原样回退 ownerId：此时权限校验会失败，语义是正确的
   * （该 Key 的归属者不在授权审批人内），而不是静默放行。
   */
  private async reviewerOf(req: any): Promise<string> {
    const ownerId = String(req?.mcpOperator || '');
    try {
      const { users } = await this.approvers.list();
      const hit = users.find((u) => String(u.id) === ownerId);
      if (hit?.username) return hit.username;
    } catch {
      // list() 自身已内建降级（返回 degraded），这里只是兜底不让审批路由 500
    }
    return ownerId;
  }

  /**
   * 取流水线并校验归属：只有**提交者本人**能查询/操作自己的流水线。
   *
   * 缺陷背景：`GET /api/mcp/pipeline/:jobId`、`cancel`、`promote` 原先都不校验归属，
   * 任何持有有效 MCP Key 的人拿到 jobId 就能读到别人的流水线详情与日志（含 env /
   * moduleKey / result）。对外开放给第三方 AI agent 平台前必须补上 ——
   * 见 `specs/backend-consolidation/design.md` §4 的 D0。
   *
   * 安全约定：归属不符抛 **404 而非 403**。用状态码回答「jobId 是否存在」本身也是信息泄露。
   *
   * 注：本校验只覆盖 MCP 通道；控制台 `/api/pipelines/*` 走 JWT 与角色权限，行为不变。
   */
  private async ownedPipeline(jobId: string, req: any) {
    const p = await this.pipelineService.get(jobId);
    if (p.operator !== this.operator(req)) {
      throw new NotFoundException(`流水线不存在: ${jobId}`);
    }
    return p;
  }

  // ── 发布提案（L1 只读 dry-run）──

  /**
   * `release_plan`：在不执行的前提下算出这一次发布的影响面、前置检查与风险。
   *
   * 与 `POST /api/mcp/pipeline` 的关系：**先 plan 后 submit**。
   * - 本接口只读：不写任何业务数据、不触发构建、不碰版本指针。
   *   因此**不需要** `confirm=true`（`confirm` 是给会改变系统的动作用的，
   *   给只读接口加确认开关只会让调用方养成无脑传 true 的习惯）。
   * - 返回的 `planId` 是输入指纹（幂等），`evidenceHash` 是当时的事实指纹：
   *   后续 `release_submit` 带 planId 提交时用它判断"提案是否已过期"。
   * - `blockers` 非空意味着提交会被直接拒绝，调用方应当先解决再提交。
   *
   * 返回体里的 `warnings` / `knownGaps` 必须下发给调用方：**没报警不等于检查过**。
   *
   * ⚠️ 校验为什么挂在这一个方法上：`main.ts` **没有**全局 `ValidationPipe`，
   * 而本控制器其余路由收 `any` 并各自手校验（错误文案是既有契约的一部分）。
   * 整体开全局管道会改变它们的行为，故只对新增的这条 DTO 化的路由开启。
   */
  @Post('release-plan')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      // 剥掉未声明字段：多余的入参不该悄悄流进 plan 的输入指纹里
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )
  @ApiOperation({ summary: '发布提案（只读 dry-run：影响面 + 前置检查 + 风险 + 是否需审批）' })
  async releasePlan(@Body() body: ReleasePlanDto) {
    return this.releasePlanService.plan({
      env: body.env,
      moduleKey: body.moduleKey,
      versionTag: body.versionTag,
      mode: body.mode as 'direct' | 'grayscale' | undefined,
      grayscaleRule: body.grayscaleRule,
    });
  }

  /**
   * 发布后验证 —— 回答「这次发布，线上真的生效了吗」。
   *
   * 与 `release_plan` 是发布前后的一对：plan 管「发之前能不能发」，
   * 这里管「发之后是不是真的发了」。
   *
   * ⚠️ 判据不是流水线状态：`status=succeeded` 只说明脚本跑完，
   * 不说明产物真的落地、进程真的重启。这里比对的是**此刻线上事实**。
   *
   * 返回体里的 `warnings` / `knownGaps` 必须下发给调用方：**没报警不等于检查过**。
   */
  @Post('release-verify')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )
  @ApiOperation({ summary: '发布后验证（只读：线上事实比对，确认发布是否真的生效）' })
  async releaseVerify(@Body() body: ReleaseVerifyDto) {
    return this.releaseVerifyService.verify({
      env: body.env,
      moduleKey: body.moduleKey,
      versionTag: body.versionTag,
      jobId: body.jobId,
      strict: body.strict,
    });
  }

  // ── 发布流水线 ──

  @Post('pipeline')
  @ApiOperation({ summary: '提交发布流水线（异步，返回 jobId）' })
  async submitPipeline(@Body() body: any, @Req() req: any) {
    const env = String(body?.env || '');
    if (env === 'prod' && body?.confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    const result = await this.pipelineService.submit(
      {
        env,
        moduleKey: String(body?.moduleKey || ''),
        mode: body?.mode,
        // ⚠️ branch / commitId 必须显式转发。
        // mcp-gateway 的 publish_pipeline 声明里就有这两个参数，Agent 会认真传；
        // 早期这里漏转，结果是**静默忽略** —— 请求 200、流水线照常跑，
        // 但发布的是默认分支 master 的最新提交，不是调用方指定的 commit。
        // 这比报错更坏：没有失败信号，事故要到上线后才发现。
        branch: body?.branch,
        commitId: body?.commitId,
        versionTag: body?.versionTag,
        target: body?.target,
        grayscaleRule: body?.grayscaleRule,
      },
      this.operator(req),
    );
    return { jobId: result.jobId, status: result.status };
  }

  @Get('pipeline/:jobId')
  @ApiOperation({ summary: '查询流水线状态/进度/日志（仅流水线提交者本人可见）' })
  async getPipeline(@Param('jobId') jobId: string, @Req() req: any) {
    const p = await this.ownedPipeline(jobId, req);
    return {
      jobId: p.id,
      env: p.env,
      moduleKey: p.moduleKey,
      versionTag: p.versionTag,
      mode: p.mode,
      status: p.status,
      stage: p.stage,
      progress: p.progress,
      logs: p.logs,
      error: p.error,
      result: p.result,
      operator: p.operator,
      startTime: p.startTime,
      endTime: p.endTime,
    };
  }

  @Post('pipeline/:jobId/cancel')
  @ApiOperation({ summary: '取消流水线（幂等）' })
  async cancelPipeline(@Param('jobId') jobId: string, @Req() req: any) {
    await this.ownedPipeline(jobId, req);
    return this.pipelineService.cancel(jobId, this.operator(req));
  }

  @Post('pipeline/:jobId/promote')
  @ApiOperation({ summary: '灰度转全量' })
  async promote(@Param('jobId') jobId: string, @Req() req: any) {
    await this.ownedPipeline(jobId, req);
    return this.pipelineService.promote(jobId, this.operator(req));
  }

  /**
   * 审批通过 —— 打通自动化发布的「最后一公里」。
   *
   * 背景：流水线提交（`POST /api/mcp/pipeline`）走 MCP Key 没问题，但构建完成后
   * 挂起 `awaiting-approval` 时 MCP 通道**没有审批路由**，只能回到控制台 JWT 的
   * `/api/pipelines/:id/approve`。结果是自动化发布永远卡在半路，最后一步不得不
   * 自签控制台 JWT 绕过（不可审计、与「优先 MCP Key」的约定相悖）。
   *
   * 安全约定（与控制台一致，不因通道放宽）：
   *  - `ownedPipeline()`：只有**提交者本人**能审批自己的流水线（非本人 → 404）
   *  - prod 必须 `confirm=true`（审批是最终放行点，比提交更需要显式确认）
   *  - 审批人由 Key 的 ownerId 解析而来（`reviewerOf`），审计可追溯到人；
   *    权限仍走 `deploy:pipeline:approve`，MCP 通道**不放宽**任何校验
   */
  @Post('pipeline/:jobId/approve')
  @ApiOperation({ summary: '审批通过（仅提交者本人；prod 需 confirm=true）' })
  async approvePipeline(
    @Param('jobId') jobId: string,
    @Body() body: { comment?: string; nodeKey?: string; confirm?: boolean },
    @Req() req: any,
  ) {
    const p = await this.ownedPipeline(jobId, req);
    if (p.env === 'prod' && body?.confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    const reviewer = await this.reviewerOf(req);
    const result = await this.pipelineService.approve(
      jobId,
      reviewer,
      body?.comment,
      body?.nodeKey,
    );
    return { jobId, ...result };
  }

  /** 审批拒绝（意见必填，与控制台同语义） */
  @Post('pipeline/:jobId/reject')
  @ApiOperation({ summary: '审批拒绝（仅提交者本人；必填审批意见）' })
  async rejectPipeline(
    @Param('jobId') jobId: string,
    @Body() body: { comment?: string; nodeKey?: string },
    @Req() req: any,
  ) {
    await this.ownedPipeline(jobId, req);
    if (!body?.comment?.trim()) {
      throw new BadRequestException('拒绝必须填写审批意见');
    }
    const reviewer = await this.reviewerOf(req);
    const result = await this.pipelineService.reject(
      jobId,
      reviewer,
      body?.comment,
      body?.nodeKey,
    );
    return { jobId, ...result };
  }

  // ── 版本 / 回滚（复用既有 DeployService） ──

  @Post('version')
  @ApiOperation({ summary: '发布指定版本（秒级切换，不重新构建）' })
  async publishVersion(@Body() body: any, @Req() req: any) {
    const env = String(body?.env || '');
    const versionTag = String(body?.versionTag || '');
    if (env === 'prod' && body?.confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    const operator = this.operator(req);
    try {
      const { component } = await this.deployService.startPublishVersion(env, versionTag, operator);
      return { status: 'success', component, versionTag, env };
    } catch (e) {
      // 回退：版本表无记录（历史 deploy.sh 写入的 component 形如 mf:admin）时，
      // 若产物确实存在则直接切指针，保证回滚能力可用。需要调用方传 component。
      const msg = (e as Error).message || '';
      if (msg.includes('版本不存在') && body?.component) {
        return {
          status: 'success',
          ...(await this.pipelineService.switchPointer(
            env,
            String(body.component),
            versionTag,
            operator,
          )),
          fallback: true,
        };
      }
      throw e;
    }
  }

  @Post('rollback')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: '指定模块回滚到指定版本，不执行整站恢复' })
  async rollback(@Body() body: ModuleRollbackDto, @Req() req: any) {
    const env = String(body?.env || '');
    if (env === 'prod' && body?.confirm !== true) {
      throw new BadRequestException('Prod operations require confirm=true');
    }
    const taskId = await this.deployService.startRollback(
      env,
      String(body?.versionTag || ''),
      this.operator(req),
      body.component,
    );
    return { taskId, status: 'started', env, versionTag: body?.versionTag };
  }

  // ── 查询类 ──

  @Get('modules')
  @ApiOperation({ summary: '可发布模块清单' })
  async modules() {
    return this.deployService.listModules();
  }

  @Get('current-versions')
  @ApiOperation({ summary: '某环境各模块当前版本' })
  @ApiQuery({ name: 'env', required: true, type: String })
  async currentVersions(@Query('env') env: string) {
    return this.deployService.getCurrentVersions(env);
  }

  @Get('releases')
  @ApiOperation({ summary: '版本历史（回滚候选，含磁盘上未登记版本表的历史产物）' })
  @ApiQuery({ name: 'env', required: false, type: String })
  @ApiQuery({ name: 'component', required: false, type: String })
  async releases(@Query('env') env?: string, @Query('component') component?: string) {
    // 版本表记录 + 磁盘产物，按 versionTag 去重（与控制台同一实现）
    return this.pipelineService.listReleaseCandidates(env, component);
  }

  // ── dev-only：mock 长任务（验证 T3 双模式，不触发真实构建） ──

  @Post('mock-job')
  @ApiOperation({ summary: '[dev-only] 提交模拟长任务' })
  async submitMockJob(@Body() body: any) {
    this.assertNotProduction();
    const seconds = Math.min(Math.max(Number(body?.seconds ?? 5), 1), 600);
    const jobId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.mockJobs.set(jobId, { status: 'running', startedAt: Date.now(), seconds });
    setTimeout(() => {
      const job = this.mockJobs.get(jobId);
      if (job) job.status = 'succeeded';
    }, seconds * 1000);
    return { jobId, status: 'pending', seconds };
  }

  @Get('mock-job/:jobId')
  @ApiOperation({ summary: '[dev-only] 查询模拟长任务状态' })
  async getMockJob(@Param('jobId') jobId: string) {
    this.assertNotProduction();
    const job = this.mockJobs.get(jobId);
    if (!job) throw new NotFoundException(`mock 任务不存在: ${jobId}`);
    const elapsed = (Date.now() - job.startedAt) / 1000;
    const percent = Math.min(100, Math.round((elapsed / job.seconds) * 100));
    return {
      jobId,
      status: job.status,
      progress: {
        current: percent,
        total: 100,
        message: `模拟任务运行中（${Math.floor(elapsed)}/${job.seconds}s）`,
      },
      result: job.status === 'succeeded' ? { ok: true, elapsedSeconds: job.seconds } : undefined,
    };
  }

  private assertNotProduction(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
  }
}
