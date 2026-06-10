import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength, IsEmail, IsOptional } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: '用户名', example: 'newname' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  username?: string;

  @ApiPropertyOptional({ description: '密码', example: 'newpassword' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @ApiPropertyOptional({ description: '邮箱', example: 'new@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: '昵称', example: '小红' })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional({ description: '手机号', example: '13900139000' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: '头像 URL' })
  @IsOptional()
  @IsString()
  avatar?: string;

  @ApiPropertyOptional({ description: '状态', example: 'active', enum: ['active', 'inactive', 'banned'] })
  @IsOptional()
  @IsString()
  status?: 'active' | 'inactive' | 'banned';

  @ApiPropertyOptional({ description: '角色', example: ['admin'], type: [String] })
  @IsOptional()
  roles?: string[];
}
