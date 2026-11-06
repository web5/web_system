/**
 * 内容管线（content_pipelines）增改入参 DTO —— 2026-11-06 新增（#8561）。
 *
 * 为什么现在才补：这些路由历史上是 `@Body() body: any`，全局 ValidationPipe 因为没有
 * DTO 元类型直接跳过校验，于是 `0 8 0 * *` 这种非法 cron 能原样入库（#8557），
 * 直到调度器启动时静默注册失败才暴露。**坏数据进不来，就不需要靠人翻日志发现。**
 *
 * 红线：`@Body()` 不再接受裸 `any`；新增/改造接口一律走 class-validator（见 CQO 设计文档 §5.4）。
 */
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { parseCronExpression } from '../../common/cron.util';

/** 管线类型（与前端 PIPELINE_TYPES / 后端 categoryByType 对齐） */
export const PIPELINE_TYPES = ['paper', 'ai-news', 'hot-news'] as const;

/** 发布模式：publish=建草稿后直接发布，draft=只进草稿箱（个人号没发布权限时的预期终点） */
export const PUBLISH_MODES = ['publish', 'draft'] as const;

/**
 * cron 合法性约束。
 *
 * 复用与调度器同一份 `parseCronExpression`——不能让「接口说合法、调度器注册失败」
 * 出现两种口径，那等于把这次的 bug 换个地方重现。
 */
@ValidatorConstraint({ name: 'isCronExpression', async: false })
export class IsCronExpressionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return parseCronExpression(value).ok;
  }

  defaultMessage(args: ValidationArguments): string {
    const parsed = parseCronExpression(args.value);
    return `cron 不合法：${parsed.error ?? '无法解析'}`;
  }
}

/** 保存前预览入参 */
export class CronPreviewDto {
  @IsString({ message: 'cron 必须是字符串' })
  @MaxLength(128, { message: 'cron 过长（最多 128 字符）' })
  cron: string;
}

/**
 * 新增管线入参。
 *
 * 字段集合 = admin 编辑页提交的全集（whitelist + forbidNonWhitelisted 会拒未声明字段，
 * 所以这里必须与前端 dto 一一对应；漏一个字段前端就会 400）。
 */
export class PipelineCreateDto {
  @IsString({ message: 'code 必须是字符串' })
  @MaxLength(64, { message: 'code 最多 64 字符' })
  code: string;

  @IsIn([...PIPELINE_TYPES], { message: `type 只能是 ${PIPELINE_TYPES.join(' / ')}` })
  type: string;

  @Validate(IsCronExpressionConstraint)
  cron: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title_template?: string | null;

  @IsOptional()
  @IsString()
  llm_prompt?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  publish_targets?: string[] | null;

  @IsOptional()
  @IsIn([...PUBLISH_MODES], { message: `publish_mode 只能是 ${PUBLISH_MODES.join(' / ')}` })
  publish_mode?: string;

  @IsOptional()
  @IsInt({ message: 'default_cover_id 必须是整数' })
  default_cover_id?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cover_media_id?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}

/**
 * 更新管线入参：全部可选（列表页「启用/停用」只 PATCH `{enabled}`）。
 * 只传 cron 时同样要过 cron 校验——改坏调度最常见的入口就是这一条 PATCH。
 */
export class PipelineUpdateDto {
  @IsOptional()
  @IsString({ message: 'code 必须是字符串' })
  @MaxLength(64, { message: 'code 最多 64 字符' })
  code?: string;

  @IsOptional()
  @IsIn([...PIPELINE_TYPES], { message: `type 只能是 ${PIPELINE_TYPES.join(' / ')}` })
  type?: string;

  @IsOptional()
  @Validate(IsCronExpressionConstraint)
  cron?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title_template?: string | null;

  @IsOptional()
  @IsString()
  llm_prompt?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  publish_targets?: string[] | null;

  @IsOptional()
  @IsIn([...PUBLISH_MODES], { message: `publish_mode 只能是 ${PUBLISH_MODES.join(' / ')}` })
  publish_mode?: string;

  @IsOptional()
  @IsInt({ message: 'default_cover_id 必须是整数' })
  default_cover_id?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cover_media_id?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;
}
