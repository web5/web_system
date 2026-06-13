import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ description: '用户名', example: 'admin' })
  username: string;

  @ApiProperty({ description: '密码', example: '123456' })
  password: string;
}

export class RegisterDto {
  @ApiProperty({ description: '用户名', example: 'newuser' })
  username: string;

  @ApiProperty({ description: '密码', example: '123456' })
  password: string;

  @ApiPropertyOptional({ description: '邮箱', example: 'user@example.com' })
  email?: string;
}

export class WechatLoginDto {
  @ApiProperty({ description: '微信 code（OAuth2 回调返回）', example: '021xxx' })
  code: string;
}

export class MiniprogramLoginDto {
  @ApiProperty({ description: '小程序 jscode（wx.login 返回）', example: '0a1xxx' })
  code: string;

  @ApiPropertyOptional({ description: '用户昵称', example: '小明' })
  nickname?: string;

  @ApiPropertyOptional({ description: '用户头像 URL' })
  avatar?: string;
}

export class CreateUserDto {
  @ApiProperty({ description: '用户名', example: 'newuser' })
  username: string;

  @ApiProperty({ description: '密码', example: '123456' })
  password: string;

  @ApiPropertyOptional({ description: '邮箱', example: 'user@example.com' })
  email?: string;

  @ApiPropertyOptional({ description: '昵称', example: '小明' })
  nickname?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ description: '用户名' })
  username?: string;

  @ApiPropertyOptional({ description: '密码' })
  password?: string;

  @ApiPropertyOptional({ description: '邮箱' })
  email?: string;

  @ApiPropertyOptional({ description: '昵称' })
  nickname?: string;

  @ApiPropertyOptional({ description: '头像 URL' })
  avatar?: string;

  @ApiPropertyOptional({ description: '状态', enum: ['active', 'inactive', 'banned'] })
  status?: string;

  @ApiPropertyOptional({ description: '角色', example: ['user'], type: [String] })
  roles?: string[];
}
