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
  /**
   * 发布模式（2026-10-23 新增）：
   * - `publish`（默认）：建草稿 + 提交发布（freepublish）
   * - `draft`：只建草稿，停在公众号草稿箱，等人工确认后再发
   *
   * 存在的意义：公众号资质不足（未认证个人号 → 48001）时，「只进草稿箱」是
   * 一个**正常结果**而不是失败。此前只能靠发布失败后降级来表达，语义是反的：
   * 想发草稿的人和发不出去的人共用一条 drafted 路径，后台分不清。
   */
  mode?: 'draft' | 'publish';
}

export interface PublishResult {
  success: boolean;
  external_id?: string;
  error?: string;
  /**
   * 结果停在「草稿箱」而非已发布。两种来源：
   * - 主动：调用方传 `mode: 'draft'`（只建草稿，等人工确认）→ success=true
   * - 被动：发布接口没权限（微信 48001，多为未认证个人号）→ success=false
   *
   * 两种情况内容都安全躺在草稿箱里，都不该记成 failed（红叉会让人以为文章丢了）。
   */
  drafted?: boolean;
  /** 草稿的 media_id，便于人工到草稿箱定位 */
  media_id?: string;
}

/**
 * 落库 status 的统一换算：多处写入点必须共用，避免各写一遍又漏一处。
 *
 * 🔴 drafted 必须**优先于** success 判断：显式 draft 模式是 success=true + drafted=true，
 * 先判 success 会把它记成「已发布」，后台状态就骗人了。
 */
export function publicationStatus(r: PublishResult): 'success' | 'drafted' | 'failed' {
  if (r.drafted) return 'drafted';
  return r.success ? 'success' : 'failed';
}

export interface IPublisher {
  /** 目标通道编码，对应 content_publications.target */
  readonly target: string;
  publish(payload: PublishPayload): Promise<PublishResult>;
}
