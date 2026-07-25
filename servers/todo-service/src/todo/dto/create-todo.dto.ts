import { IsString, IsOptional, IsIn, IsArray, IsDateString } from 'class-validator';
import { TodoPriority, TodoCategory } from '../todo.entity';

export class CreateTodoDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high'])
  priority?: TodoPriority;

  @IsOptional()
  @IsArray()
  @IsIn(['creative', 'study', 'sport', 'music', 'other'], { each: true })
  category?: TodoCategory[];

  @IsOptional()
  @IsDateString()
  due_date?: string;
}
