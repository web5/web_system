import { BadRequestException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';

/**
 * 2026-10-08：admin 签发通道的**归属校验**回归测试。
 *
 * 判据：key 的 ownerId 是 deploy-console 发布审计的操作人字段。
 * 允许绑到不存在或已禁用的用户 = 审计指向空气，等于匿名凭据。
 */
describe('ApiKeyService.adminCreate（归属校验）', () => {
  /** 可控的用户库桩：{ [id]: { id, email, status } } */
  let users: Record<number, { id: number; email: string; status: string }>;

  const keyRepo = {
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: unknown) => x),
  };

  const userRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: number } }) => users[where.id] ?? null),
  };

  const codeRepo = { findOne: jest.fn(), save: jest.fn(), delete: jest.fn() };
  const mail = { isEnabled: async () => true, sendCode: async () => {} };

  const svc = new ApiKeyService(
    keyRepo as never,
    codeRepo as never,
    userRepo as never,
    mail as never,
  );

  beforeEach(() => {
    users = {
      1: { id: 1, email: 'admin@kedouai.com', status: 'active' },
      7: { id: 7, email: 'ops@kedouai.com', status: 'active' },
      8: { id: 8, email: 'disabled@kedouai.com', status: 'disabled' },
    };
    (keyRepo.save as jest.Mock).mockClear();
  });

  it('ownerId 指向不存在的用户 → 拒绝，不落库', async () => {
    await expect(svc.adminCreate('a@b.com', 'k', 999)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(keyRepo.save).not.toHaveBeenCalled();
  });

  it('ownerId 指向已禁用用户 → 拒绝，不落库', async () => {
    await expect(svc.adminCreate('a@b.com', 'k', 8)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(keyRepo.save).not.toHaveBeenCalled();
  });

  it('显式 ownerId 且未传 email → 回填 owner 邮箱（归属一致）', async () => {
    await svc.adminCreate(undefined as never, 'k', 7);
    const saved = (keyRepo.save as jest.Mock).mock.calls[0][0] as {
      email: string;
      ownerId: number;
      ownerType: string;
    };
    expect(saved.ownerId).toBe(7);
    expect(saved.email).toBe('ops@kedouai.com');
    expect(saved.ownerType).toBe('admin');
  });

  it('既无 email 也无 ownerId → 拒绝', async () => {
    await expect(svc.adminCreate(undefined as never, 'k', null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(keyRepo.save).not.toHaveBeenCalled();
  });

  it('正常签发：明文带 kedou_ 前缀，落库只存 hash（不存明文）', async () => {
    const { plaintext, prefix } = await svc.adminCreate('admin@kedouai.com', 'k', 1);
    expect(plaintext.startsWith('kedou_')).toBe(true);
    expect(prefix).toBe(plaintext.slice(0, 12));
    const saved = (keyRepo.save as jest.Mock).mock.calls[0][0] as {
      keyHash: string;
      keyPrefix: string;
    };
    expect(saved.keyHash).toHaveLength(64);
    expect(saved.keyHash).not.toContain(plaintext);
    expect(saved.keyPrefix).toBe(prefix);
  });
});
