import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { UI_RADIUS_STYLES } from '@web-system/shared';
import type { UiRadiusStyle } from '@web-system/shared';

/**
 * 界面偏好（`PUT /users/me` 的子对象）。
 *
 * 为什么用 DTO 白名单约束 json 列：`users.preferences` 是通用 json 列，
 * 若无白名单会被当成「任意配置桶」写入，故每个键都必须显式声明并校验。
 * 口径：specs/radius-style-dual/page-spec-pref-sync.md §3.2
 */
export class UserPreferencesDto {
  @ApiPropertyOptional({ description: '圆角风格', enum: UI_RADIUS_STYLES, example: 'soft' })
  @IsOptional()
  @IsIn(UI_RADIUS_STYLES)
  radiusStyle?: UiRadiusStyle;
}
