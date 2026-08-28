import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务异常：返回统一响应格式 { code, message }
 * 默认 HTTP 状态码 200，由前端根据 code 判断业务状态。
 */
export class BusinessException extends HttpException {
  constructor(
    message: string,
    public readonly code: number = 4001,
    status: number = HttpStatus.OK,
  ) {
    super({ code, message }, status);
  }

  getCode(): number {
    return this.code;
  }
}
