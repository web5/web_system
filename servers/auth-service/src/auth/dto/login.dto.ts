import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsOptional, IsIn } from 'class-validator';
import { SYSTEMS } from '@web-system/shared';

export class LoginDto {
  @ApiProperty({ description: '用户名', example: 'demo123' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  username: string;

  @ApiProperty({ description: '密码', example: '123456' })
  @IsString()
  @MinLength(6)
  password: string;

  /**
   * 目标系统（IAM 一期）：不传默认 portal。
   * 只用于收窄，能否登录由账号自身的归属决定。
   */
  @ApiProperty({ description: '目标系统', example: 'portal', required: false })
  @IsOptional()
  @IsIn([...SYSTEMS])
  system?: (typeof SYSTEMS)[number];
}
