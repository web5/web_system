import { IsString, IsOptional, IsIn, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 变变变身请求 DTO
 * 对应小程序 POST /bianbian/transform
 */
export class TransformDto {
  @ApiProperty({
    description: '画布导出的图片（base64 data URL，如 data:image/jpeg;base64,...）',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @IsString()
  @MinLength(100, { message: '图片数据不能为空' })
  image: string;

  @ApiPropertyOptional({
    description: '用户对作品的描述（可选，用于辅助 AI 理解画面意图）',
    example: '一只可爱的小猫在草地上玩耍',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description: '目标风格',
    example: 'pixar-3d',
    default: 'pixar-3d',
  })
  @IsOptional()
  @IsString()
  @IsIn(['pixar-3d'], { message: '当前仅支持 pixar-3d 风格' })
  style?: string = 'pixar-3d';

  @ApiPropertyOptional({
    description: '输出尺寸',
    example: '1024x1024',
    default: '1024x1024',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+x\d+$/, { message: '尺寸格式应为 WxH，如 1024x1024' })
  outputSize?: string = '1024x1024';

  @ApiPropertyOptional({
    description: '用户 ID',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}

/**
 * 变变变身响应
 */
export class TransformResponse {
  @ApiProperty({ description: '记录 ID' })
  id: string;

  @ApiProperty({ description: 'AI 生成的结果图（base64 data URL 或 CDN URL）' })
  aiImage: string;

  @ApiProperty({ description: '处理状态' })
  status: string;

  @ApiProperty({ description: '处理耗时（毫秒）' })
  processingTimeMs: number;

  @ApiProperty({ description: '当日剩余变身次数' })
  remainingToday: number;
}
