import { IsString, IsOptional, IsObject } from 'class-validator';

/** internal 口味写入口（merge=增量合并 / remove=差集移除） */
export class MergeTasteDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  namespace?: string;

  @IsObject()
  patch: Record<string, unknown>;
}
