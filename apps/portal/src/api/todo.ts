import request from './request';
import type { Todo, CreateTodoDto, UpdateTodoDto, QueryTodoParams, TodoStats, ApiResponse, PaginatedResponse } from '@/types/todo';

/** 获取任务列表 */
export function getTodoList(params: QueryTodoParams) {
  return request.get<ApiResponse<PaginatedResponse<Todo>>>('/todos', { params });
}

/** 获取任务详情 */
export function getTodoDetail(id: number) {
  return request.get<ApiResponse<Todo>>(`/todos/${id}`);
}

/** 创建任务 */
export function createTodo(data: CreateTodoDto) {
  return request.post<ApiResponse<Todo>>('/todos', data);
}

/** 更新任务 */
export function updateTodo(id: number, data: UpdateTodoDto) {
  return request.put<ApiResponse<Todo>>(`/todos/${id}`, data);
}

/** 删除任务 */
export function deleteTodo(id: number) {
  return request.delete<ApiResponse<null>>(`/todos/${id}`);
}

/** 更新任务状态 */
export function updateTodoStatus(id: number, status: Todo['status']) {
  return request.patch<ApiResponse<Todo>>(`/todos/${id}/status`, { status });
}

/** 获取任务统计 */
export function getTodoStats(period: 'today' | 'week' | 'month' = 'today') {
  return request.get<ApiResponse<TodoStats>>('/todos/stats', { params: { period } });
}
