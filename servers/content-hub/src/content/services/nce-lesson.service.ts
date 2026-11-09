/**
 * 课文只读查询。
 *
 * 对外 DTO 刻意保持与抓取产物 data/lessons.json 完全一致的 camelCase 字段，
 * 这样 PC portal / 小程序 / admin 三端可以共用同一套渲染逻辑，
 * 数据库侧则沿用仓库的 snake_case 列约定，转换只在这一层做一次。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListNceLessonsDto } from '../dto/nce-lesson.dto';
import {
  NceExercise,
  NceLessonEntity,
  NceLine,
  NceWord,
} from '../entities/nce-lesson.entity';

/**
 * 册别配置表：标题与标准课数。
 * 新增册别只需在此登记，接口层（meta/detail/list）即自动支持，
 * 无需改动任何查询逻辑（resolveBook 兜底非法/缺省 book 回落默认册）。
 */
const BOOKS: Record<string, { title: string; total: number }> = {
  NCE2: { title: '新概念英语第二册 · 实践与进步', total: 96 },
  NCE3: { title: '新概念英语第三册 · 培养技能', total: 60 },
  NCE4: { title: '新概念英语第四册 · 流利英语', total: 48 },
};
const DEFAULT_BOOK = 'NCE2';

/** 解析册别：非法值或缺省回落默认册，保证接口始终有确定性返回。 */
function resolveBook(book?: string): string {
  return book && BOOKS[book] ? book : DEFAULT_BOOK;
}

/** mysql2 对 JSON 列大多已解析成对象，但不同驱动版本可能返回字符串，这里统一兜底。 */
function asArray<T>(raw: unknown): T[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export interface NceLessonSummary {
  id: number;
  book: string;
  title: string;
  titleCn: string;
  leadQuestion: string;
  leadQuestionCn: string;
  textSource: string;
  lineCount: number;
  wordCount: number;
  exerciseCount: number;
  fetchedAt: string;
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
  textSource: string;
  lines: NceLine[];
  translation: string;
  words: NceWord[];
  exercises: NceExercise[];
  sources: string[];
  fetchedAt: string;
}

@Injectable()
export class NceLessonService {
  constructor(
    @InjectRepository(NceLessonEntity)
    private readonly repo: Repository<NceLessonEntity>,
  ) {}

  async meta(book?: string): Promise<{ book: string; bookTitle: string; total: number; downloaded: number }> {
    const b = resolveBook(book);
    const cfg = BOOKS[b];
    return {
      book: b,
      bookTitle: cfg.title,
      total: cfg.total,
      // 按册统计已入库数，而非全表 count
      downloaded: await this.repo.count({ where: { book: b } }),
    };
  }

  async list(q: ListNceLessonsDto): Promise<{ total: number; items: NceLessonSummary[] }> {
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 20, 100);
    const qb = this.repo
      .createQueryBuilder('l')
      .where('l.book = :book', { book: resolveBook(q.book) });

    if (q.keyword) {
      // 课号是数字列，LIKE 需显式 CAST；全部走参数绑定，不拼 SQL 字符串
      qb.andWhere(
        '(CAST(l.lesson_no AS CHAR) LIKE :kw OR l.title LIKE :kw OR l.title_cn LIKE :kw)',
        { kw: `%${q.keyword}%` },
      );
    }

    const [rows, total] = await qb
      .orderBy('l.lesson_no', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      total,
      items: rows.map((e) => ({
        id: e.lesson_no,
        book: e.book,
        title: e.title,
        titleCn: e.title_cn ?? '',
        leadQuestion: e.lead_question ?? '',
        leadQuestionCn: e.lead_question_zh ?? '',
        textSource: e.text_source,
        lineCount: asArray<NceLine>(e.lines).length,
        wordCount: asArray<NceWord>(e.words).length,
        exerciseCount: asArray<NceExercise>(e.exercises).length,
        fetchedAt: e.fetched_at ? e.fetched_at.toISOString() : '',
      })),
    };
  }

  async detail(id: number, book?: string): Promise<NceLessonDetail> {
    const b = resolveBook(book);
    const e = await this.repo.findOne({ where: { book: b, lesson_no: id } });
    if (!e) throw new NotFoundException(`[${b}] Lesson ${id} 未入库`);
    return {
      id: e.lesson_no,
      book: e.book,
      bookTitle: e.book_title || BOOKS[b].title,
      title: e.title,
      titleCn: e.title_cn ?? '',
      leadQuestion: e.lead_question ?? '',
      leadQuestionCn: e.lead_question_zh ?? '',
      text: e.text ?? '',
      textSource: e.text_source,
      lines: asArray<NceLine>(e.lines),
      translation: e.translation ?? '',
      words: asArray<NceWord>(e.words),
      exercises: asArray<NceExercise>(e.exercises),
      sources: asArray<string>(e.sources),
      fetchedAt: e.fetched_at ? e.fetched_at.toISOString() : '',
    };
  }
}
