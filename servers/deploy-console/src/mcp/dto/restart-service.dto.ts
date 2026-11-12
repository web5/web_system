import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * `POST /api/mcp/restart` 入参（设计 §3.9）。
 *
 * 「干净重启当前指针版本」：不改版本、不改配置、不动 dist。
 * restart 恒等于 registry 当前指针版本，因此**没有 versionTag 字段**
 * （构造上杜绝「绕过发布门禁改版本」的后门，设计 R6）。
 *
 * 字段别名说明：mcp-gateway 工具面（restart_service）命名对齐既有工具的
 * `component` / snake_case 习惯（rollback 用 component、dry_run），
 * 故 `component` / `dry_run` 作为 `moduleKey` / `dryRun` 的别名一并声明，
 * 由控制器归一（whitelist 管道会剥掉未声明字段，别名必须在 DTO 里显式存在）。
 */
export class RestartServiceDto {
  /** 目标环境（restart 走远程隔离运行时，v1 仅 dev/prod） */
  @IsIn(['dev', 'prod'], { message: 'env 仅支持 dev/prod' })
  env: string;

  /** 模块 key（type=backend 的后端服务） */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  moduleKey?: string;

  /** moduleKey 的别名（mcp-gateway 工具面命名习惯） */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  component?: string;

  /** prod 必须传 true（对齐 rollback / publish 现状） */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  /** true = 只跑只读前置断言并返回执行计划，不碰进程 */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** dryRun 的别名（mcp-gateway 工具面 snake_case） */
  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;

  /** 重启原因（prod 必填，写审计） */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}
