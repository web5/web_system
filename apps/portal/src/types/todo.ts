/** 任务状态 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';

/** 任务优先级 */
export type TodoPriority = 'low' | 'medium' | 'high';

/** 任务分类 */
export type TodoCategory = 'creative' | 'study' | 'sport' | 'music' | 'other';

/** 任务对象 */
export interface Todo {
  id: number;
  title: string;
  description?: string;
  status: TodoStatus;
  priority: TodoPriority;
  category?: TodoCategory[];
  due_date?: string;
  completed_at?: string;
  user_id: number;
  created_at: string;
  updated_at: string;
}

/** 创建任务 DTO */
export interface CreateTodoDto {
  title: string;
  description?: string;
  priority?: TodoPriority;
  category?: TodoCategory[];
  due_date?: string;
}

/** 更新任务 DTO */
export interface UpdateTodoDto {
  title?: string;
  description?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  category?: TodoCategory[];
  due_date?: string;
}

/** 查询任务参数 */
export interface QueryTodoParams {
  page?: number;
  pageSize?: number;
  status?: TodoStatus;
  priority?: TodoPriority;
  category?: TodoCategory;
  keyword?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 任务统计 */
export interface TodoStats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  completionRate: number;
}

/** API 统一响应 */
export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}
