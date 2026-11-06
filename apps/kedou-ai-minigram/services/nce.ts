/**
 * 新概念英语课文（小程序 ↔ content-hub）
 *
 * 三端共用只读接口：`/api/content-admin/nce/*`（gateway 用户 JWT 通道，
 * pathRewrite 后落到 content-hub 的 `@Controller('api/nce')`）。
 * 小程序 request 封装不拆包，故统一用 Wrapped<T> 并取 res.data。
 * 契约见 docs/development/nce-integration-spec.md §三。
 */
import { get } from '../utils/request';

interface Wrapped<T> {
  code: number;
  data: T;
  message?: string;
}

const BASE = '/api/content-admin/nce';

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

export interface NceLine { en: string; cn: string }
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

export async function getNceMeta(): Promise<NceMeta> {
  const res = await get<Wrapped<NceMeta>>(`${BASE}/meta`);
  return res?.data ?? { book: 'NCE2', bookTitle: '新概念英语第二册', total: 96, downloaded: 0 };
}

export async function listNceLessons(
  page = 1,
  pageSize = 100,
  keyword = '',
): Promise<{ total: number; items: NceLessonSummary[] }> {
  const q = `${BASE}/lessons?page=${page}&pageSize=${pageSize}&keyword=${encodeURIComponent(keyword)}`;
  const res = await get<Wrapped<{ total: number; items: NceLessonSummary[] }>>(q);
  return res?.data ?? { total: 0, items: [] };
}

export async function getNceLesson(id: number): Promise<NceLessonDetail | null> {
  const res = await get<Wrapped<NceLessonDetail>>(`${BASE}/lessons/${id}`);
  return res?.data ?? null;
}
