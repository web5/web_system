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
 * 自动将返回值包装为 { code: 0, data, message: 'success' }
 * 已完成格式化的响应（含 code 字段）直接透传
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, WrappedResponse<T> | T> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<WrappedResponse<T> | T> {
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && 'code' in data) {
          return data;
        }
        return {
          code: 0,
          data: data ?? null,
          message: 'success',
        } as WrappedResponse<T>;
      }),
    );
  }
}
