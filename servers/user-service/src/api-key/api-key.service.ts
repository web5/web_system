import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import { McpApiKeyEntity } from './entities/mcp-api-key.entity';
import { McpKeyCodeEntity } from './entities/mcp-key-code.entity';
import { MailService } from './mail.service';
import { User } from '@web-system/shared';

const KEY_PREFIX_STR = 'kedou_';
const CODE_TTL_MS = 10 * 60 * 1000;
const APPLY_RATE_LIMIT_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    @InjectRepository(McpApiKeyEntity)
    private readonly keyRepo: Repository<McpApiKeyEntity>,
    @InjectRepository(McpKeyCodeEntity)
    private readonly codeRepo: Repository<McpKeyCodeEntity>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly mail: MailService,
  ) {}

  /** 生成明文 key（仅返回一次），存储 hash + prefix + ownerId */
  private async createKey(
    email: string,
    name?: string,
    ownerId?: number | null,
    ownerType: 'apply' | 'admin' = 'apply',
  ): Promise<{ plaintext: string; prefix: string }> {
    const raw = randomBytes(24).toString('hex'); // 48 hex chars
    const plaintext = KEY_PREFIX_STR + raw;
    const keyHash = createHash('sha256').update(plaintext).digest('hex');
    const prefix = plaintext.slice(0, 12);
    await this.keyRepo.save(
      this.keyRepo.create({
        email,
        name: name ?? null,
        ownerId: ownerId ?? null,
        keyHash,
        keyPrefix: prefix,
        status: 'active',
        ownerType,
      }),
    );
    return { plaintext, prefix };
  }

  /** 校验 key（用于内部 /internal/keys/verify）；返回 null 表示无效/过期 */
  async verifyKey(plaintext: string): Promise<McpApiKeyEntity | null> {
    let keyHash: string;
    try {
      keyHash = createHash('sha256').update(plaintext).digest('hex');
    } catch {
      return null;
    }
    const record = await this.keyRepo.findOne({ where: { keyHash, status: 'active' } });
    if (!record) return null;
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;
    record.lastUsedAt = new Date();
    await this.keyRepo.save(record);
    return record;
  }

  /**
   * 申请：兼容两种形态
   *   - 已登录：传 ownerId，用账户邮箱发码并绑定
   *   - 自助：传 email（ownerId 为空）
   * 返回实际发码邮箱，供前端提示
   */
  async apply(dto: { email?: string; ownerId?: number }): Promise<string> {
    let email = dto.email;
    if (dto.ownerId) {
      const user = await this.userRepo.findOne({ where: { id: dto.ownerId } });
      if (!user) throw new NotFoundException('用户不存在');
      email = user.email;
    }
    if (!email) {
      throw new BadRequestException('缺少邮箱（已登录用户需先绑定邮箱）');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('邮箱格式不正确');
    }
    if (!this.mail.enabled) {
      throw new ForbiddenException('邮件服务未配置，暂不可申请');
    }
    const recent = await this.codeRepo.findOne({ where: { email }, order: { id: 'DESC' } });
    if (recent?.lastSentAt && Date.now() - recent.lastSentAt.getTime() < APPLY_RATE_LIMIT_MS) {
      throw new ForbiddenException('请求过于频繁，请 60 秒后再试');
    }
    const code = String(randomInt(100000, 999999));
    const codeHash = createHash('sha256').update(code).digest('hex');
    await this.codeRepo.save(
      this.codeRepo.create({
        email,
        codeHash,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        attempts: 0,
        lastSentAt: new Date(),
      }),
    );
    await this.mail.sendCode(email, code);
    this.logger.log(`已向 ${email} 发送验证码`);
    return email;
  }

  /** 校验验证码并签发 key（明文仅返回一次），绑定 ownerId（若有） */
  async verifyAndIssue(
    dto: { email?: string; ownerId?: number; code: string; name?: string },
  ): Promise<{ plaintext: string; prefix: string }> {
    let email = dto.email;
    if (dto.ownerId) {
      const user = await this.userRepo.findOne({ where: { id: dto.ownerId } });
      if (!user) throw new NotFoundException('用户不存在');
      email = user.email;
    }
    if (!email) throw new BadRequestException('缺少邮箱');
    const record = await this.codeRepo.findOne({ where: { email }, order: { id: 'DESC' } });
    if (!record) throw new BadRequestException('请先获取验证码');
    if (record.expiresAt.getTime() < Date.now()) throw new BadRequestException('验证码已过期，请重新获取');
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) throw new BadRequestException('尝试验证次数过多，请重新获取');
    const codeHash = createHash('sha256').update(dto.code).digest('hex');
    if (record.codeHash !== codeHash) {
      record.attempts += 1;
      await this.codeRepo.save(record);
      throw new BadRequestException('验证码错误');
    }
    await this.codeRepo.delete({ id: record.id });
    return this.createKey(email, dto.name, dto.ownerId ?? null, 'apply');
  }

  /** 用户中心：我的 keys（脱敏） */
  async listByOwner(ownerId: number): Promise<any[]> {
    const rows = await this.keyRepo.find({ where: { ownerId }, order: { id: 'DESC' } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix,
      status: r.status,
      ownerType: r.ownerType,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
    }));
  }

  /** 用户中心：吊销我的 key */
  async revokeByOwner(id: number, ownerId: number): Promise<void> {
    const r = await this.keyRepo.findOne({ where: { id, ownerId } });
    if (!r) throw new NotFoundException('key 不存在');
    r.status = 'revoked';
    r.revokedAt = new Date();
    await this.keyRepo.save(r);
  }

  /** 运营：列表 */
  async list(): Promise<McpApiKeyEntity[]> {
    return this.keyRepo.find({ order: { id: 'DESC' } });
  }

  /** 运营：吊销 */
  async revoke(id: number): Promise<void> {
    const r = await this.keyRepo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('key 不存在');
    r.status = 'revoked';
    r.revokedAt = new Date();
    await this.keyRepo.save(r);
  }

  /** 运营：直接创建（免邮件） */
  async adminCreate(email: string, name?: string): Promise<{ plaintext: string; prefix: string }> {
    return this.createKey(email, name, null, 'admin');
  }
}
