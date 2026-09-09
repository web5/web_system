/**
 * Admin - RAG 知识集合（Phase3·D6.2 知识集合行）
 *
 * 后端：knowledge-service（gateway /api/knowledge → 6011）
 * 权限：知识集合读 knowledge:view；写操作 knowledge:manage
 */
import request from './request';

export interface KnowledgeCollection {
  id: string;
  name: string;
  description: string | null;
  embedModel: string;
  enabled: boolean;
  docCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDoc {
  id: string;
  collectionId: string;
  title: string;
  source: string | null;
  status: 'parsing' | 'ready' | 'failed';
  chunkCount: number;
  error: string | null;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: string;
  docId: string;
  seq: number;
  content: string;
}

function unwrap<T>(res: unknown, fallback: T): T {
  if (Array.isArray(res)) return res as T;
  if (res && typeof res === 'object' && 'data' in res) {
    const d = (res as { data?: unknown }).data;
    if (d !== undefined && d !== null) return d as T;
  }
  return fallback;
}

export async function fetchCollections(): Promise<KnowledgeCollection[]> {
  const res: unknown = await request.get('/knowledge/collections');
  return unwrap(res, []);
}

export async function createCollection(body: { name: string; description?: string }): Promise<KnowledgeCollection> {
  const res: unknown = await request.post('/knowledge/collections', body);
  return unwrap(res, body as unknown as KnowledgeCollection);
}

export async function updateCollection(id: string, body: { name?: string; description?: string }): Promise<KnowledgeCollection> {
  const res: unknown = await request.put(`/knowledge/collections/${id}`, body);
  return unwrap(res, body as unknown as KnowledgeCollection);
}

export async function toggleCollection(id: string, enabled: boolean): Promise<void> {
  await request.post(`/knowledge/collections/${id}/toggle`, { enabled });
}

export async function deleteCollection(id: string): Promise<void> {
  await request.delete(`/knowledge/collections/${id}`);
}

export async function fetchDocs(collectionId: string): Promise<KnowledgeDoc[]> {
  const res: unknown = await request.get('/knowledge/documents', { params: { collectionId } });
  return unwrap(res, []);
}

export async function fetchDocDetail(id: string): Promise<{ doc: KnowledgeDoc; chunks: KnowledgeChunk[] }> {
  const res: unknown = await request.get(`/knowledge/documents/${id}`);
  return unwrap(res, { doc: {} as KnowledgeDoc, chunks: [] });
}

export async function ingestDoc(body: {
  collectionId: string;
  title: string;
  text: string;
  source?: string;
}): Promise<{ docId: string; status: string; chunkCount: number; duplicate: boolean }> {
  const res: unknown = await request.post('/knowledge/documents', body);
  return unwrap(res, { docId: '', status: 'failed', chunkCount: 0, duplicate: false });
}

export async function deleteDoc(id: string): Promise<void> {
  await request.delete(`/knowledge/documents/${id}`);
}

export async function searchKnowledge(params: {
  collectionId: string;
  query: string;
  topK?: number;
}): Promise<Array<{ chunkId: string; content: string; docId: string; docTitle: string; seq: number; score: number }>> {
  const res: unknown = await request.get('/knowledge/search', { params });
  return unwrap(res, []);
}
