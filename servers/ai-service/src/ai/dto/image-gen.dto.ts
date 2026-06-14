import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImageSubmitDto {
  @ApiProperty({ description: '图片生成提示词', example: '雨中, 竹林, 小路' })
  @IsString()
  @IsNotEmpty()
  prompt: string;
}

export class ImageQueryDto {
  @ApiProperty({ description: '任务 ID' })
  @IsString()
  @IsNotEmpty()
  id: string;
}
