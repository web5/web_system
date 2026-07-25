import { IsOptional, IsString, IsIn, IsArray, IsDateString } from 'class-validator';
import { TodoStatus, TodoPriority, TodoCategory } from '../todo.entity';

export class UpdateTodoDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['pending', 'in_progress', 'completed', 'overdue', 'cancelled'])
  status?: TodoStatus;

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
