/**
 * 微信小程序服务端能力
 *
 * 只做两件事：
 * 1) 全局 access_token 的获取与缓存（7200s，进程内并发去重 + Redis 缓存）
 * 2) 手机号快速验证：code → 真实手机号（新版 phonenumber.getPhoneNumber）
 *
 * 不落库、不解密 session_key：登录流程本就丢弃 session_key，
 * 走新版「code 换号」无需持久化它（方案 §5.1）。
 */
import { Injectable, Logger, BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService, DEFAULT_REDIS } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import axios from 'axios';

const ACCESS_TOKEN_KEY = 'wx:mp:access_token';
/** 微信返回 7200s，提前 200s 过期，避免边界时刻用到快失效的 token */
const ACCESS_TOKEN_TTL = 7000;

@Injectable()
export class WechatMpService {
  private readonly logger = new Logger(WechatMpService.name);
  private fetching: Promise<string> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  private get redis(): Redis {
    return this.redisService.getOrThrow(DEFAULT_REDIS);
  }

  private get appId(): string {
    return this.configService.get<string>('MINI_PROGRAM_APP_ID') || '';
  }

  private get secret(): string {
    return this.configService.get<string>('MINI_PROGRAM_SECRET') || '';
  }

  /** 小程序全局 access_token（缓存优先，miss 时进程内并发去重） */
  async getAccessToken(): Promise<string> {
    const cached = await this.redis.get(ACCESS_TOKEN_KEY).catch(() => null);
    if (cached) return cached;

    if (!this.fetching) {
      this.fetching = this.fetchAccessToken().finally(() => {
        this.fetching = null;
      });
    }
    return this.fetching;
  }

  private async fetchAccessToken(): Promise<string> {
    if (!this.appId || !this.secret) {
      throw new BadGatewayException('小程序凭证未配置（MINI_PROGRAM_APP_ID / MINI_PROGRAM_SECRET）');
    }
    const { data } = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
      params: { grant_type: 'client_credential', appid: this.appId, secret: this.secret },
      timeout: 8000,
    });
    if (!data?.access_token) {
      this.logger.warn(`获取小程序 access_token 失败: ${JSON.stringify(data)}`);
      throw new BadGatewayException('微信接口调用失败');
    }
    await this.redis.set(ACCESS_TOKEN_KEY, data.access_token, 'EX', ACCESS_TOKEN_TTL).catch(() => null);
    return data.access_token as string;
  }

  /**
   * 手机号快速验证：一次性 code → 真实手机号
   * 官方：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html
   */
  async getPhoneNumber(code: string): Promise<string> {
    if (!code) throw new BadRequestException('缺少手机号授权 code');
    const accessToken = await this.getAccessToken();
    const { data } = await axios.post(
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`,
      { code },
      { timeout: 8000 },
    );
    if (data?.errcode) {
      this.logger.warn(`换取手机号失败: errcode=${data.errcode} errmsg=${data.errmsg}`);
      // 40001/42001：access_token 失效 → 清缓存，下次请求自动重取
      if (data.errcode === 40001 || data.errcode === 42001) {
        await this.redis.del(ACCESS_TOKEN_KEY).catch(() => null);
      }
      throw new BadGatewayException('微信手机号校验失败');
    }
    const phone = data?.phone_info?.purePhoneNumber || data?.phone_info?.phoneNumber;
    if (!phone) throw new BadGatewayException('微信未返回手机号');
    return phone as string;
  }
}
