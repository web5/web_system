import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

/**
 * 个人中心：修改自己的密码（需校验旧密码）。
 * 对应接口：PUT /users/me/password（AuthGuard，登录用户本人）。
 */
export class ChangeOwnPasswordDto {
  @ApiProperty({ description: '旧密码', example: 'oldpass123' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  oldPassword: string;

  @ApiProperty({ description: '新密码', example: 'newpass456' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  newPassword: string;
}

/**
 * 用户管理：管理员重置任意用户密码（无需旧密码）。
 * 对应接口：PUT /users/:id/password（AuthGuard + users:edit）。
 */
export class ResetPasswordDto {
  @ApiProperty({ description: '新密码', example: 'newpass456' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  newPassword: string;
}
