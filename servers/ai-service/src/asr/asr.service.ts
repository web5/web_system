import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as https from 'https';

const ASR_HOST = 'asr.tencentcloudapi.com';
const ASR_SERVICE = 'asr';
const ASR_REGION = 'ap-guangzhou';
const ASR_ACTION = 'SentenceRecognition';
const ASR_VERSION = '2019-06-14';

/**
 * 识别引擎：16k_zh（中文普通话）。
 * 语音输入以中文为主，英文单词在该引擎下也有基本识别能力；
 * 若后续要支持中英混合场景，可换成对应引擎（16k_zh_en）并由前端传 engine 覆盖。
 */
const DEFAULT_ENGINE = '16k_zh';

/** 支持的音频格式（与小程序 RecorderManager 的 format 对齐） */
const SUPPORTED_FORMATS = ['mp3', 'wav', 'pcm', 'aac', 'amr', 'm4a'] as const;

/** 音频原始字节上限（腾讯云一句话识别 ≤60s；这里再按体积兜一道，防超大 base64 打爆内存） */
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/** 识别超时：云侧偶发抖动时不能把前端挂死 */
const REQUEST_TIMEOUT_MS = 15000;

export interface RecognizeResult {
  /** 识别出的文本（空串 = 没听清） */
  text: string;
  /** 云侧回传的音频时长（ms） */
  durationMs: number;
}

/**
 * TC3 签名结果。
 * ⚠️ 必须带索引签名：否则传给 https/axios 的 headers 会因「缺少索引签名」不可赋值
 * （CI 实测 TS2322：自定义 interface 不兼容 OutgoingHttpHeaders / AxiosHeaders）。
 */
export interface Tc3Headers {
  [key: string]: string;
  Authorization: string;
  'Content-Type': string;
  Host: string;
  'X-TC-Action': string;
  'X-TC-Version': string;
  'X-TC-Timestamp': string;
  'X-TC-Region': string;
}

/**
 * 腾讯云 API 3.0 签名（TC3-HMAC-SHA256）。
 *
 * 为什么手写而不是加 SDK 依赖：仓库里现成的 `tencentcloud-sdk-nodejs` 只带了 tts 子包，
 * 引入 asr 子包要动 dev/prod 的 node_modules（部署成本 + 依赖漂移风险）。
 * 签名算法本身是固定的四步派生，用 Node 内置 crypto 就能完成，零新增依赖。
 *
 * 官方算法（docs: 签名方法 v3）：
 *   1. canonicalRequest = 方法 + 路径 + 查询串 + 规范 headers + 签名 headers + payload 哈希
 *   2. stringToSign      = 算法 + 时间戳 + 凭证范围 + canonicalRequest 哈希
 *   3. 派生密钥           = HMAC(TC3+SecretKey, date) → service → "tc3_request"
 *   4. signature         = HMAC(派生密钥, stringToSign)
 *
 * ⚠️ 只签 `content-type` 与 `host`（与官方示例一致）：x-tc-* 头不进签名。
 */
export function signTc3Request(params: {
  secretId: string;
  secretKey: string;
  service: string;
  host: string;
  payload: string;
  timestamp: number;
  region: string;
  action: string;
  version: string;
}): Tc3Headers {
  const { secretId, secretKey, service, host, payload, timestamp, region, action, version } = params;

  // UTC 日期（签名用的 date 必须是 UTC 自然日，不能用本地时区）
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const contentType = 'application/json';
  const signedHeaders = 'content-type;host';
  // 规范 headers：小写键、值去首尾空格、末尾必须带 \n、按字典序
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;

  const hashedPayload = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n');

  const hmac = (key: crypto.BinaryLike, data: string): Buffer =>
    crypto.createHmac('sha256', key as crypto.BinaryLike).update(data, 'utf8').digest();
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = crypto
    .createHmac('sha256', secretSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: host,
    'X-TC-Action': action,
    'X-TC-Version': version,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Region': region,
  };
}

@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name);
  private readonly secretId: string;
  private readonly secretKey: string;

  constructor(private readonly configService: ConfigService) {
    this.secretId = this.configService.get<string>('TENCENT_SECRET_ID') || '';
    this.secretKey = this.configService.get<string>('TENCENT_SECRET_KEY') || '';

    if (!this.secretId || !this.secretKey) {
      // 与 TTS 同一口径：凭据缺失要在启动日志与 /health 里暴露，而不是等用户点麦克风才失败
      this.logger.warn('ASR 未配置：缺少 TENCENT_SECRET_ID / TENCENT_SECRET_KEY，语音识别将不可用');
    } else {
      this.logger.log('腾讯云 ASR 凭据已加载');
    }
  }

  /** 是否具备识别条件（controller 的 /health 据此返回，前端未配置时禁用麦克风） */
  isAvailable(): boolean {
    return !!(this.secretId && this.secretKey);
  }

  /**
   * 语音识别（一句话识别）：base64 音频 → 文本。
   * @param audioBase64 音频内容（base64，不含 data URI 前缀）
   * @param format 音频格式，默认 mp3
   * @throws 参数不合法 / 未配置 / 云侧错误（错误信息已做用户侧脱敏）
   */
  async recognize(audioBase64: string, format = 'mp3'): Promise<RecognizeResult> {
    if (!this.isAvailable()) {
      throw new Error('ASR 未配置，请在 .env 中设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY');
    }

    const fmt = String(format || '').toLowerCase();
    if (!SUPPORTED_FORMATS.includes(fmt as (typeof SUPPORTED_FORMATS)[number])) {
      throw new Error(`不支持的音频格式: ${format}`);
    }

    const data = String(audioBase64 || '').trim();
    if (!data) {
      throw new Error('音频内容为空');
    }
    // base64 长度 → 原始字节（去掉可能的 padding 再换算，避免 5MB 边界误判）
    const rawLen = Math.floor((data.length - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)) * 3 / 4);
    if (rawLen <= 0) {
      throw new Error('音频内容为空');
    }
    if (rawLen > MAX_AUDIO_BYTES) {
      throw new Error('音频过长，请缩短后重试');
    }

    const payload = JSON.stringify({
      ProjectId: 0,
      // SubServiceType=2：一句话识别（录音时长 ≤60s）
      SubServiceType: 2,
      EngSerViceType: DEFAULT_ENGINE,
      // SourceType=1：语音数据走 Data 字段（base64）
      SourceType: 1,
      VoiceFormat: fmt,
      UsrAudioKey: `mp-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      Data: data,
      DataLen: rawLen,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const headers = signTc3Request({
      secretId: this.secretId,
      secretKey: this.secretKey,
      service: ASR_SERVICE,
      host: ASR_HOST,
      payload,
      timestamp,
      region: ASR_REGION,
      action: ASR_ACTION,
      version: ASR_VERSION,
    });

    try {
      // 内置 https（不用 axios）：零类型摩擦，且与签名验证脚本用的是同一条路径
      const res = await postJson(ASR_HOST, payload, headers, REQUEST_TIMEOUT_MS);
      const body = JSON.parse(res.body) as {
        Response?: { Result?: string; AudioDuration?: number; Error?: { Code?: string; Message?: string } };
      };
      if (res.status !== 200) {
        this.logger.error(`ASR HTTP ${res.status}: ${res.body.slice(0, 200)}`);
        throw new Error('识别服务暂时不可用，请稍后重试');
      }
      const r = body?.Response;
      if (r?.Error) {
        // 云侧错误码不透传原文（可能含 Credential/SecretId 等），统一按类别给前端可展示的信息
        throw new Error(this.mapCloudError(r.Error.Code, r.Error.Message));
      }
      return {
        text: String(r?.Result || '').trim(),
        durationMs: Number(r?.AudioDuration || 0),
      };
    } catch (e) {
      // 自己抛的业务错误（未配置 / 参数非法 / 已映射的云侧错误）原样上抛
      // 已映射成用户可读文案的错误原样上抛（勿再包一层"服务不可用"，否则掩盖真正原因）
      if (e instanceof Error && /ASR 未配置|未开通|不支持的音频格式|音频|识别失败/.test(e.message)) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`ASR 请求失败: ${msg}`);
      throw new Error('识别服务暂时不可用，请稍后重试');
    }
  }

  /** 云侧错误 → 用户可看的提示（技术原文不透传） */
  private mapCloudError(code?: string, raw?: string): string {
    const c = String(code || '');
    if (/AuthFailure|Signature|SecretId|SecretKey|Credential/i.test(c)) {
      this.logger.error(`ASR 凭据/签名异常: ${c} ${raw || ''}`);
      return '识别服务未配置正确，请联系管理员';
    }
    // 服务未开通 / 被隔离：属于运维问题，不是用户重试能解决的，必须明确区分
    // （实测首次调用返回 FailedOperation.UserNotRegistered — "User is unopened! [biz: ASR_OneSentence]"）
    if (/UserNotRegistered|ServiceIsolate|Unopened|Isolate/i.test(c)) {
      this.logger.error(`ASR 服务未开通/被隔离: ${c} ${raw || ''}`);
      return '语音识别服务未开通，请联系管理员';
    }
    if (/LimitExceeded|RequestLimit/i.test(c)) return '识别请求过于频繁，请稍后再试';
    if (/FailedOperation|InvalidParameter/i.test(c)) {
      this.logger.warn(`ASR 云侧拒绝: ${c} ${raw || ''}`);
      return '这段音频没能识别，请再说一次';
    }
    this.logger.warn(`ASR 云侧错误: ${c} ${raw || ''}`);
    return '识别失败，请重试';
  }
}

/**
 * 向腾讯云发一个 JSON POST（内置 https，带超时）。
 * ⚠️ 非 2xx 也原样返回 body：云侧错误码在 body 里（如 UserNotRegistered），
 * 丢掉 body 就无法区分「服务未开通」和「识别失败」了。
 */
function postJson(
  host: string,
  payload: string,
  headers: Tc3Headers,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        path: '/',
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('ASR 请求超时')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
