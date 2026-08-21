/** 腾讯文档发布器——Open API（OAuth2 client credentials）。凭据未配置时降级跳过。 */
import { Injectable, Logger } from '@nestjs/common';
import { IPublisher, PublishPayload, PublishResult } from './publisher.interface';

const TOKEN_URL = 'https://docs.qq.com/oauth/v2/token';
const FILES_URL = 'https://docs.qq.com/openapi/drive/v2/files';

@Injectable()
export class TencentDocsPublisher implements IPublisher {
  readonly target = 'tencent_docs';
  private readonly logger = new Logger(TencentDocsPublisher.name);
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const clientId = process.env.TENCENT_DOCS_CLIENT_ID ?? '';
    const clientSecret = process.env.TENCENT_DOCS_CLIENT_SECRET ?? '';
    if (!clientId || !clientSecret) {
      return { success: false, error: '腾讯文档凭据未配置（TENCENT_DOCS_CLIENT_ID/SECRET）' };
    }

    try {
      const token = await this.getAccessToken(clientId, clientSecret);
      const docId = await this.createDoc(token, payload.title, payload.markdown ?? '');
      // 移动目录：需实测官方接口后接入（folder 对应目录 ID）
      if (payload.folder) {
        this.logger.log(`[tencent_docs] 文档 ${docId} 待移入目录 ${payload.folder}（目录移动接口待校验）`);
      }
      return { success: true, external_id: docId };
    } catch (e) {
      this.logger.error(`腾讯文档发布失败: ${(e as Error).message}`);
      return { success: false, error: (e as Error).message };
    }
  }

  /** 获取 access_token（client credentials，缓存至过期前 60s） */
  private async getAccessToken(clientId: string, clientSecret: string): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken!;
    }
    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    if (!resp.ok) {
      throw new Error(`获取 access_token 失败: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + Number(data.expires_in ?? 7200) * 1000 - 60_000;
    return data.access_token;
  }

  /** 创建文档，返回 doc id */
  private async createDoc(token: string, title: string, markdown: string): Promise<string> {
    const resp = await fetch(FILES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'doc',
        title,
        content: markdown,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`创建文档失败: HTTP ${resp.status} ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.file_id ?? data.fileId ?? data.id ?? '';
  }
}
