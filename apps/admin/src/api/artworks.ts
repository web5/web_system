import request from './request';

export type ArtworkSourceType = 'bianbian' | 'draw-ai' | 'design' | 'ai-art';

export interface ArtworkItem {
  id: string;
  userId: number;
  title: string;
  imageUrl?: string;
  originalImageUrl?: string;
  sourceType: ArtworkSourceType;
  prompt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ArtworkListResponse {
  code: number;
  data: ArtworkItem[];
}

/**
 * 获取用户的作品列表
 */
export function getArtworks(userId: number): Promise<ArtworkListResponse> {
  return request.get('/ai/artworks', { params: { userId } });
}

export const artworksApi = {
  getByUser: getArtworks,
};
