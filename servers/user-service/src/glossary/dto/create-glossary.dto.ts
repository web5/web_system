import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsObject } from 'class-validator';

export class CreateGlossaryDto {
  @ApiProperty({ description: '来源', enum: ['chat', 'translate'], example: 'chat' })
  @IsIn(['chat', 'translate'])
  sourceType: 'chat' | 'translate';

  @ApiPropertyOptional({ description: '中文原文', example: '非常感谢你的帮助' })
  @IsOptional()
  @IsString()
  sourceText?: string;

  @ApiProperty({ description: '英文译文主文', example: 'Thank you for your help.' })
  @IsString()
  enMain: string;

  @ApiPropertyOptional({ description: '注解 / 直译对照', example: 'for your help 点明感谢对象' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: '语气 / 风格 / 方向 meta', example: { tone: '正式', direction: 'zh2en' } })
  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '关联会话 id' })
  @IsOptional()
  @IsString()
  conversationId?: string;
}
