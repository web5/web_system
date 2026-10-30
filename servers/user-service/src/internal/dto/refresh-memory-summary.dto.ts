import { IsOptional, IsString } from 'class-validator';

/** 触发用户记忆摘要重算（internal，服务间） */
export class RefreshMemorySummaryDto {
  @IsString()
  userId: string;

  /** 摘要域，v1 只用 general（表已预留多域） */
  @IsOptional()
  @IsString()
  namespace?: string;
}
