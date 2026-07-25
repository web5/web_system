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

export interface SaveArtworkParams {
  userId: number;
  title: string;
  imageUrl?: string;
  originalImageUrl?: string;
  sourceType: ArtworkSourceType;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

export interface ApiResponse<T = unknown> {
  code: number;
  message?: string;
  data: T;
}

/**
 * 保存作品到用户相册
 */
export function saveArtwork(params: SaveArtworkParams): Promise<ApiResponse<ArtworkItem>> {
  return request.post('/ai/artworks', params);
}

/**
 * 获取用户相册列表
 */
export function getArtworks(userId: number): Promise<ApiResponse<ArtworkItem[]>> {
  return request.get('/ai/artworks', { params: { userId } });
}

/**
 * 删除相册中的作品
 */
export function deleteArtwork(id: string, userId: number): Promise<ApiResponse<null>> {
  return request.delete(`/ai/artworks/${id}`, { params: { userId } });
}
