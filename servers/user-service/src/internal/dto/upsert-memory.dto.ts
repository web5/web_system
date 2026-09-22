import { IsString, IsArray, IsOptional, IsNumber, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpsertMemoryItemDto {
  @IsString()
  category: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsNumber()
  confidence?: number;

  @IsOptional()
  @IsIn(['add', 'remove'])
  action?: 'add' | 'remove';
}

export class UpsertMemoryDto {
  @IsString()
  userId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertMemoryItemDto)
  items: UpsertMemoryItemDto[];

  @IsOptional()
  @IsString()
  sourceConversationId?: string;
}
