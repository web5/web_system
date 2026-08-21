/** 采集器抽象——各来源适配器统一输出 RawItem */

export interface RawItem {
  /** 源内唯一 id（arXiv id / url hash） */
  external_id: string;
  title: string;
  content: string;
  url?: string;
  source_name: string;
  publish_date?: Date;
  /** 封面图 / 作者 / 点赞数等源私有字段 */
  meta?: Record<string, unknown>;
}

export interface ICollector {
  /** 采集器编码，对应 content_sources.type */
  readonly code: string;
  /** 采集一批条目 */
  collect(config?: Record<string, unknown>, limit?: number): Promise<RawItem[]>;
}
