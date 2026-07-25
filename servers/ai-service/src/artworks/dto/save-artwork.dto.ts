import { IsInt, IsString, IsOptional, IsIn, IsObject } from 'class-validator';

export class SaveArtworkDto {
  @IsInt()
  userId: number;

  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  originalImageUrl?: string;

  @IsString()
  @IsIn(['bianbian', 'draw-ai', 'design', 'ai-art'])
  sourceType: 'bianbian' | 'draw-ai' | 'design' | 'ai-art';

  @IsString()
  @IsOptional()
  prompt?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
