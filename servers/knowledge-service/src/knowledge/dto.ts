import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateCollectionDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  embedModel?: string;
}

export class UpdateCollectionDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  embedModel?: string;
}

export class ToggleCollectionDto {
  @IsBoolean()
  enabled: boolean;
}

export class IngestDocDto {
  @IsString()
  @IsNotEmpty()
  collectionId: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  title: string;

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsOptional()
  @IsString()
  source?: string;
}

export class SearchQueryDto {
  @IsString()
  @IsNotEmpty()
  collectionId: string;

  @IsString()
  @IsNotEmpty()
  query: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;
}

export class DeleteKnowledgeDto {
  @IsOptional()
  @IsString()
  collectionId?: string;

  @IsOptional()
  @IsString()
  docId?: string;
}

export class EvalCaseDto {
  @IsString()
  @IsNotEmpty()
  question: string;
}

/** Ragas 评测入参：检索+问答对（3.5 脚本化，结果纳入 Phase4 eval_cases） */
export class RunEvalDto {
  @IsString()
  @IsNotEmpty()
  collectionId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EvalCaseDto)
  cases: EvalCaseDto[];
}
