import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * 日志查询 DTO（同时用于远端 /monitor/logs 与本机 /monitor/local/logs）
 * service 直接参与本机/远端 shell 命令拼接，必须严格白名单校验，杜绝命令注入。
 */
export class LogsQueryDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'service 仅允许字母、数字、下划线和连字符',
  })
  service!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  lines?: number;
}
