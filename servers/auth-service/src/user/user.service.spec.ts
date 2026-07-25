import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from './user.entity';

describe('UserService', () => {
  let service: UserService;
  let repository: jest.Mocked<Partial<Repository<User>>>;

  const mockUser: User = {
    id: 1,
    username: 'test_user',
    password: null,
    email: null,
    phone: null,
    nickname: 'Test',
    avatar: '',
    gender: 'unknown',
    mpOpenid: null,
    oaOpenid: null,
    status: 'active',
    roles: ['user'],
    dailyTransformLimit: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    repository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(User), useValue: repository },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  // ============ 查找方法 ============

  describe('findByUsername', () => {
    it('应通过用户名查找到用户', async () => {
      repository.findOne.mockResolvedValue(mockUser);
      const result = await service.findByUsername('test_user');
      expect(result).toEqual(mockUser);
      expect(repository.findOne).toHaveBeenCalledWith({ where: { username: 'test_user' } });
    });

    it('用户名不存在应返回 null', async () => {
      repository.findOne.mockResolvedValue(null);
      const result = await service.findByUsername('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('应通过 ID 查找到用户', async () => {
      repository.findOne.mockResolvedValue(mockUser);
      const result = await service.findById(1);
      expect(result).toEqual(mockUser);
    });
  });

  describe('findByMpOpenid', () => {
    it('应通过小程序 openid 查找到用户', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser, mpOpenid: 'mp_openid_123' });
      const result = await service.findByMpOpenid('mp_openid_123');
      expect(result).not.toBeNull();
      expect(repository.findOne).toHaveBeenCalledWith({ where: { mpOpenid: 'mp_openid_123' } });
    });
  });

  describe('findByOaOpenid', () => {
    it('应通过公众号 openid 查找到用户', async () => {
      repository.findOne.mockResolvedValue({ ...mockUser, oaOpenid: 'oa_openid_456' });
      const result = await service.findByOaOpenid('oa_openid_456');
      expect(result).not.toBeNull();
      expect(repository.findOne).toHaveBeenCalledWith({ where: { oaOpenid: 'oa_openid_456' } });
    });
  });

  // ============ 创建微信用户（独立，不合并）============

  describe('createMpUser', () => {
    it('应创建小程序用户', async () => {
      const newUser = { ...mockUser, mpOpenid: 'mp_abc123', username: 'wx_mp_abc123' };
      repository.create.mockReturnValue(newUser as any);
      repository.save.mockResolvedValue(newUser);

      const result = await service.createMpUser({
        mpOpenid: 'mp_abc123',
        nickname: '小微信',
        avatar: 'https://example.com/avatar.png',
      });

      expect(result.mpOpenid).toBe('mp_abc123');
      expect(result.username).toContain('wx_');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mpOpenid: 'mp_abc123',
          roles: ['user'],
        }),
      );
    });

    it('不同 openid 应创建不同用户，不做合并', async () => {
      const user1 = { ...mockUser, id: 1, mpOpenid: 'mp_1', username: 'wx_mp_1' };
      const user2 = { ...mockUser, id: 2, mpOpenid: 'mp_2', username: 'wx_mp_2' };

      repository.create.mockReturnValueOnce(user1 as any).mockReturnValueOnce(user2 as any);
      repository.save.mockResolvedValueOnce(user1).mockResolvedValueOnce(user2);

      const r1 = await service.createMpUser({ mpOpenid: 'mp_1', nickname: 'u1', avatar: '' });
      const r2 = await service.createMpUser({ mpOpenid: 'mp_2', nickname: 'u2', avatar: '' });

      expect(r1.id).toBe(1);
      expect(r2.id).toBe(2);
      expect(r1.mpOpenid).not.toBe(r2.mpOpenid);
    });
  });

  describe('createOaUser', () => {
    it('应创建公众号用户', async () => {
      const newUser = { ...mockUser, oaOpenid: 'oa_xyz', username: 'wx_oa_xyz' };
      repository.create.mockReturnValue(newUser as any);
      repository.save.mockResolvedValue(newUser);

      const result = await service.createOaUser({
        oaOpenid: 'oa_xyz',
        nickname: '公众号用户',
        avatar: '',
      });

      expect(result.oaOpenid).toBe('oa_xyz');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ oaOpenid: 'oa_xyz' }),
      );
    });
  });

  // ============ 绑定方法 ============

  describe('bindMpOpenid', () => {
    it('应将小程序 openid 绑定到用户', async () => {
      // 第一次 findByMpOpenid → 无冲突
      // 第二次 findById → 返回 mockUser（update 中调用）
      repository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      const updatedUser = { ...mockUser, mpOpenid: 'mp_bind_123' };
      repository.save.mockResolvedValue(updatedUser);

      const result = await service.bindMpOpenid(1, 'mp_bind_123');

      expect(result.mpOpenid).toBe('mp_bind_123');
    });

    it('openid 已被其他用户绑定时应抛出异常', async () => {
      const otherUser = { ...mockUser, id: 2, mpOpenid: 'mp_bind_123' };
      repository.findOne.mockResolvedValue(otherUser);

      await expect(service.bindMpOpenid(1, 'mp_bind_123')).rejects.toThrow(BadRequestException);
    });

    it('同一用户重复绑定同一 openid 应成功（幂等）', async () => {
      const existingUser = { ...mockUser, id: 1, mpOpenid: 'mp_bind_123' };
      repository.findOne
        .mockResolvedValueOnce(existingUser) // findByMpOpenid 找到的是自己
        .mockResolvedValueOnce(mockUser);    // findById（update 中）
      repository.save.mockResolvedValue(existingUser);

      const result = await service.bindMpOpenid(1, 'mp_bind_123');
      expect(result.mpOpenid).toBe('mp_bind_123');
    });
  });

  describe('bindOaOpenid', () => {
    it('应将公众号 openid 绑定到用户', async () => {
      repository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      const updatedUser = { ...mockUser, oaOpenid: 'oa_bind_456' };
      repository.save.mockResolvedValue(updatedUser);

      const result = await service.bindOaOpenid(1, 'oa_bind_456');
      expect(result.oaOpenid).toBe('oa_bind_456');
    });

    it('openid 已被其他用户绑定时应抛出异常', async () => {
      const otherUser = { ...mockUser, id: 2, oaOpenid: 'oa_bind_456' };
      repository.findOne.mockResolvedValue(otherUser);

      await expect(service.bindOaOpenid(1, 'oa_bind_456')).rejects.toThrow(BadRequestException);
    });
  });

  // ============ 基础 CRUD ============

  describe('create', () => {
    it('应创建用户名密码用户', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(mockUser as any);
      repository.save.mockResolvedValue(mockUser);

      const result = await service.create({
        username: 'test_user',
        password: 'hashed_pw',
      });

      expect(result).toEqual(mockUser);
    });

    it('用户名已存在应抛出 ConflictException', async () => {
      repository.findOne.mockResolvedValue(mockUser);
      await expect(
        service.create({ username: 'test_user', password: 'pw' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    it('应更新用户信息', async () => {
      repository.findOne.mockResolvedValue(mockUser);
      repository.save.mockResolvedValue({ ...mockUser, nickname: '新昵称' });

      const result = await service.update(1, { nickname: '新昵称' });
      expect(result.nickname).toBe('新昵称');
    });

    it('用户不存在应抛出 NotFoundException', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.update(999, { nickname: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('应删除用户', async () => {
      repository.delete.mockResolvedValue({ affected: 1, raw: {} });
      await expect(service.delete(1)).resolves.not.toThrow();
    });

    it('用户不存在应抛出 NotFoundException', async () => {
      repository.delete.mockResolvedValue({ affected: 0, raw: {} });
      await expect(service.delete(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('应更新用户状态', async () => {
      repository.findOne.mockResolvedValue(mockUser);
      repository.save.mockResolvedValue({ ...mockUser, status: 'banned' });

      const result = await service.updateStatus(1, 'banned');
      expect(result.status).toBe('banned');
    });
  });
});
