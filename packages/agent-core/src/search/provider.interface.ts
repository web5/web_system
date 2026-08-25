/**
 * 搜索 Provider 插件接口。
 * 实现此接口即可注册为 web-search 的数据源（如 Bing、博查、未来其他）。
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source?: string;
}

export interface SearchProvider {
  /** 唯一标识（如 'bing'、'bocha'） */
  readonly id: string;
  /** 展示名 */
  readonly name: string;
  /** 是否已配置（key 是否就绪） */
  isAvailable(): boolean;
  /** 执行搜索，返回结构化结果 */
  search(query: string, limit?: number): Promise<SearchResult[]>;
}
