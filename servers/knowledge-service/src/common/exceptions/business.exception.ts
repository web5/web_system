import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务异常：HTTP 状态固定 200，code 区分业务状态（与统一响应约定一致）。
 */
export class BusinessException extends HttpException {
  private readonly codeValue: number;

  constructor(message: string, code = 4000, status: HttpStatus = HttpStatus.OK) {
    super(message, status);
    this.codeValue = code;
  }

  getCode(): number {
    return this.codeValue;
  }
}
