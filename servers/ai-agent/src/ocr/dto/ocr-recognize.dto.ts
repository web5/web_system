import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class OcrRecognizeDto {
  @IsString({ message: 'imageBase64 必须是字符串' })
  @IsNotEmpty({ message: '图片内容不能为空' })
  imageBase64: string;

  @IsOptional()
  @IsString({ message: 'scene 必须是字符串' })
  scene?: string;
}
