/** 发布器抽象——腾讯文档 / 公众号等通道统一契约 */

export interface PublishPayload {
  title: string;
  /** 腾讯文档用 Markdown */
  markdown?: string;
  /** 公众号用 HTML */
  html?: string;
  /** 公众号封面 thumb_media_id */
  thumb_media_id?: string;
  /** 公众号摘要（digest，选填） */
  digest?: string;
  /** 腾讯文档目标目录 */
  folder?: string;
  /** 原文链接（用于出处标注） */
  source_url?: string;
}

export interface PublishResult {
  success: boolean;
  external_id?: string;
  error?: string;
}

export interface IPublisher {
  /** 目标通道编码，对应 content_publications.target */
  readonly target: string;
  publish(payload: PublishPayload): Promise<PublishResult>;
}
