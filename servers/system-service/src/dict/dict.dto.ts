import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DictAttrValue } from './dict-item.entity';
import { DictFieldType, DICT_FIELD_TYPES } from './dict-field.entity';

/** 编码只允许小写字母/数字/下划线，避免业务侧引用时大小写歧义 */
const CODE_PATTERN = /^[a-z][a-z0-9_]*$/;

// ===== 字典类型 =====

export class CreateDictTypeDto {
  @IsString()
  @Length(1, 64)
  @Matches(CODE_PATTERN, { message: '编码只能包含小写字母、数字和下划线，且以字母开头' })
  code: string;

  @IsString()
  @Length(1, 128)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateDictTypeDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListDictTypesDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;
}

// ===== 字段定义 =====

export class DictFieldDto {
  @IsString()
  @Length(1, 64)
  @Matches(CODE_PATTERN, { message: '字段名只能包含小写字母、数字和下划线，且以字母开头' })
  name: string;

  @IsString()
  @Length(1, 128)
  label: string;

  @IsIn(DICT_FIELD_TYPES as unknown as string[])
  type: DictFieldType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  length?: number;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultValue?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsInt()
  sort?: number;
}

/** 字段定义整体覆盖保存（前端提交最终态，天然支持重排/删除） */
export class ReplaceDictFieldsDto {
  @Type(() => DictFieldDto)
  @ValidateNested({ each: true })
  @IsArray()
  @ArrayMaxSize(30)
  fields: DictFieldDto[];
}

// ===== 字典项 =====

export class CreateDictItemDto {
  @IsString()
  @Length(1, 64)
  @Matches(CODE_PATTERN, { message: '字典编码只能包含小写字母、数字和下划线，且以字母开头' })
  typeCode: string;

  @IsString()
  @Length(1, 128)
  value: string;

  @IsString()
  @Length(1, 255)
  label: string;

  /** 自定义字段值；具体取值规则由 dict_fields 决定，service 内二次校验 */
  @IsOptional()
  @IsObject()
  attrs?: Record<string, DictAttrValue>;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateDictItemDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  label?: string;

  @IsOptional()
  @IsObject()
  attrs?: Record<string, DictAttrValue>;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @IsOptional()
  @IsInt()
  sort?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListDictItemsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string;

  /** query 传 "true"/"false" 字符串，需显式转换后再校验 */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
