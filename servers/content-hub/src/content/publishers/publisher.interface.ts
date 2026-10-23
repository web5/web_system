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
  /** 公众号多账号：不传用默认号；传 kedouai 等走对应账号凭据 */
  account?: string;
}

export interface PublishResult {
  success: boolean;
  external_id?: string;
  error?: string;
  /**
   * 草稿已建成，但发布接口没权限（微信 48001 api unauthorized，多为未认证个人号）。
   * 此时文章静静躺在公众号草稿箱里，需要人工去后台点发布 ——
   * 既不是成功（读者看不到），也不是失败（内容没丢，不该记成红叉）。
   */
  drafted?: boolean;
  /** 草稿的 media_id，便于人工到草稿箱定位 */
  media_id?: string;
}

/** 落库 status 的统一换算：三处写入点必须共用，避免各写一遍又漏一处 */
export function publicationStatus(r: PublishResult): 'success' | 'drafted' | 'failed' {
  if (r.success) return 'success';
  return r.drafted ? 'drafted' : 'failed';
}

export interface IPublisher {
  /** 目标通道编码，对应 content_publications.target */
  readonly target: string;
  publish(payload: PublishPayload): Promise<PublishResult>;
}
