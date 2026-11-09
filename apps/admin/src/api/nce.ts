/**
 * Admin - 新概念英语课文（只读预览）
 *
 * 后端 content-hub 的 @Controller('api/nce')，经 gateway `/api/content-admin/*`
 * 用户 JWT 通道，pathRewrite `^/api/content-admin` → `/api`。
 * 请求前缀因此是 `/content-admin/nce`。
 * 响应拦截器已拆 `{ code, data }`，这里返回类型直接写 data 本体。
 * 字段契约见 docs/development/nce-integration-spec.md §三。
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

export interface ListNceParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  book?: string;
}

export function getNceMeta(): Promise<NceMeta> {
  return request.get('/content-admin/nce/meta');
}

export function listNceLessons(params: ListNceParams = {}): Promise<{ total: number; items: NceLessonSummary[] }> {
  return request.get('/content-admin/nce/lessons', { params });
}

export function getNceLesson(id: number): Promise<NceLessonDetail> {
  return request.get(`/content-admin/nce/lessons/${id}`);
}
