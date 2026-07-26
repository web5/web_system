import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface WrappedResponse<T = unknown> {
  code: number;
  data: T;
  message?: string;
}

/**
 * 统一响应格式拦截器
 * 自动将 controller 返回值包装为 { code: 0, data, message?: 'success' }
 *
 * 如果返回值已经包含 `code` 字段，则视为已格式化，跳过包装
 * 已格式化的响应可直接返回 { code: 0, data, message }
 * 异常错误由 AllExceptionsFilter 统一处理，不经过此拦截器
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, WrappedResponse<T> | T> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<WrappedResponse<T> | T> {
    return next.handle().pipe(
      map((data) => {
        // 已格式化的响应（含 code 字段）直接透传
        if (data && typeof data === 'object' && 'code' in data) {
          return data;
        }
        // 未格式化的一律包成 { code: 0, data }
        return {
          code: 0,
          data: data ?? null,
          message: 'success',
        } as WrappedResponse<T>;
      }),
    );
  }
}
