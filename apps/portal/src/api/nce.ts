/**
 * 新概念英语课文（PC portal「发现」入口）
 *
 * 后端 content-hub @Controller('api/nce')，经 gateway `/api/content-admin/*` 用户 JWT 通道。
 * 响应拦截器已拆 `{ code, data }`，这里返回类型直接写 data 本体。
 * 契约见 docs/development/nce-integration-spec.md §三。
 */
import request from './request';

export interface NceMeta {
  book: string;
  bookTitle: string;
  total: number;
  downloaded: number;
}

export interface NceLessonSummary {
  id: number;
  book: string;
  title: string;
  titleCn: string;
  leadQuestion: string;
  leadQuestionCn: string;
  textSource: 'xdf' | 'lrc';
  lineCount: number;
  wordCount: number;
  exerciseCount: number;
  fetchedAt: string;
}

export interface NceLine {
  en: string;
  cn: string;
}
export interface NceWord {
  word: string;
  phonetic?: string;
  pos?: string;
  def?: string;
  example?: string;
}
export interface NceExercise {
  q: string;
  options: string[];
  answer: number;
  exp?: string;
}
export interface NceLessonDetail {
  id: number;
  book: string;
  bookTitle: string;
  title: string;
  titleCn: string;
  leadQuestion: string;
  leadQuestionCn: string;
  text: string;
  textSource: 'xdf' | 'lrc';
  lines: NceLine[];
  translation: string;
  words: NceWord[];
  exercises: NceExercise[];
  sources: string[];
  fetchedAt: string;
}

export function getNceMeta(book?: string): Promise<NceMeta> {
  return request.get<NceMeta>('/content-admin/nce/meta', { params: book ? { book } : undefined }) as unknown as Promise<NceMeta>;
}

export function listNceLessons(params: { page?: number; pageSize?: number; keyword?: string; book?: string } = {}): Promise<{ total: number; items: NceLessonSummary[] }> {
  return request.get<{ total: number; items: NceLessonSummary[] }>('/content-admin/nce/lessons', { params }) as unknown as Promise<{ total: number; items: NceLessonSummary[] }>;
}

export function getNceLesson(id: number, book?: string): Promise<NceLessonDetail> {
  return request.get<NceLessonDetail>(`/content-admin/nce/lessons/${id}`, { params: book ? { book } : undefined }) as unknown as Promise<NceLessonDetail>;
}
