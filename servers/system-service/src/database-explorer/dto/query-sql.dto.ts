import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/** 执行只读 SQL */
export class QuerySqlDto {
  @IsString()
  @IsNotEmpty({ message: 'SQL 不能为空' })
  @MaxLength(2000, { message: 'SQL 过长（上限 2000 字符）' })
  sql: string;
}
