import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { InternalGuard } from '../api-key/internal.guard';
import {
  BindIdentityDto,
  IdentityService,
  ResolveIdentityDto,
  UnbindIdentityDto,
} from './identity.service';

/**
 * 外部身份内部接口（`x-internal-key: INTERNAL_API_KEY`）。
 *
 * 契约真源：docs/development/wecom-approval-identity-contract.md
 * - resolve 查无返回 `data: null`，不是 404/500：调用方要能区分「没绑定」与「服务不可用」，
 *   企微审批通道对后者必须 fail-closed（spec V14），不能当成「没人绑」放行。
 * - 与 permission/internal.controller.ts 同前缀、`@Controller('internal')` 多 controller 并存。
 */
@Controller('internal')
@UseGuards(InternalGuard)
export class IdentityController {
  constructor(private readonly svc: IdentityService) {}

  @Post('identities/resolve')
  @HttpCode(200)
  async resolve(@Body() dto: ResolveIdentityDto) {
    const data = await this.svc.resolve(dto);
    return { code: 0, data, message: data ? 'ok' : 'not-bound' };
  }

  @Post('identities/bind')
  @HttpCode(200)
  async bind(@Body() dto: BindIdentityDto) {
    const data = await this.svc.bind(dto);
    return { code: 0, data, message: 'ok' };
  }

  @Post('identities/unbind')
  @HttpCode(200)
  async unbind(@Body() dto: UnbindIdentityDto) {
    await this.svc.unbind(dto);
    return { code: 0, message: 'ok' };
  }
}
