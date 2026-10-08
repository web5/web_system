import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ApiKeyController } from './api-key.controller';

/**
 * 2026-10-08：admin 直接签发通道的回归测试。
 *
 * 核心判据是**审计可追溯** —— deploy-console 的 McpKeyGuard 用 key 的 ownerId
 * 作为发布审计的操作人。此前的 `adminCreate` 把 ownerId 硬编码为 null，
 * 等于发匿名凭据：发布记录里查不到责任人。以下用例锁死「必须绑到人」。
 */
describe('ApiKeyController.adminCreate', () => {
  /** lastCall 记录传给 service 的实参，用于断言 ownerId 绑定来源 */
  let lastCall: { email: string; name?: string; ownerId?: number | null };

  const svc = {
    adminCreate: jest.fn(
      async (email: string, name?: string, ownerId?: number | null) => {
        lastCall = { email, name, ownerId };
        return { plaintext: 'kedou_testkey', prefix: 'kedou_testk' };
      },
    ),
  } as unknown as ConstructorParameters<typeof ApiKeyController>[0];

  const controller = new ApiKeyController(svc);

  beforeEach(() => {
    lastCall = undefined as never;
    (svc.adminCreate as jest.Mock).mockClear();
  });

  it('非 admin 角色 → 拒绝（403/401），不签发', async () => {
    await expect(
      controller.adminCreate({ user: { id: 9, roles: ['user'] } }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(svc.adminCreate).not.toHaveBeenCalled();
  });

  it('roles 为逗号字符串时也能识别 admin', async () => {
    const r = await controller.adminCreate(
      { user: { id: 1, roles: 'admin,ops', email: 'a@b.com' } },
      { name: 'x' },
    );
    expect(r.ownerId).toBe(1);
  });

  it('未显式传 ownerId → 绑定到操作者本人（可追溯）', async () => {
    const r = await controller.adminCreate(
      { user: { id: 1, roles: ['admin'], email: 'admin@kedouai.com' } },
      { name: 'ai-ops-automation' },
    );
    expect(lastCall.ownerId).toBe(1);
    expect(lastCall.email).toBe('admin@kedouai.com');
    expect(r.ownerId).toBe(1);
    expect(r.key).toBe('kedou_testkey');
  });

  it('显式传 ownerId → 以显式值为准', async () => {
    const r = await controller.adminCreate(
      { user: { id: 1, roles: ['admin'], email: 'admin@kedouai.com' } },
      { ownerId: 7, email: 'ops@kedouai.com' },
    );
    expect(lastCall.ownerId).toBe(7);
    expect(lastCall.email).toBe('ops@kedouai.com');
    expect(r.ownerId).toBe(7);
  });

  it('既无 dto.email 也无 user.email → 拒绝（不产出无主 key）', async () => {
    await expect(
      controller.adminCreate({ user: { id: 1, roles: ['admin'] } }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.adminCreate).not.toHaveBeenCalled();
  });
});
