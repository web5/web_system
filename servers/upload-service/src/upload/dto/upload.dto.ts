import { ApiProperty } from '@nestjs/swagger';

export class UploadFileResponseDto {
  @ApiProperty({ description: '文件访问 URL' })
  url: string;

  @ApiProperty({ description: '文件名' })
  filename: string;

  @ApiProperty({ description: '文件大小（字节）' })
  size: number;

  @ApiProperty({ description: 'MIME 类型' })
  mimetype: string;

  @ApiProperty({ description: '上传类型' })
  category: string;
}

export class UploadResponseDto {
  @ApiProperty({ description: '状态码' })
  code: number;

  @ApiProperty({ description: '上传结果' })
  data: UploadFileResponseDto;
}

export class MultiUploadResponseDto {
  @ApiProperty({ description: '状态码' })
  code: number;

  @ApiProperty({ description: '上传结果列表' })
  data: UploadFileResponseDto[];
}
