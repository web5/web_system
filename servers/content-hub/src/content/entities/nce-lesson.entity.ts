/**
 * 新概念英语课文（NCE2）——与抓取产物 data/lessons.json 单课对象一一对应。
 *
 * 约定：
 * - `lesson_no` 对应 JSON 的 `id`（课号 1..96），表主键另用自增 `id`；
 * - 标量落独立列便于检索/排序，数组与对象落原生 JSON 列，不二次拆表；
 * - `lead_question_zh` 是 JSON 新增字段 `leadQuestionCn` 的落点（原站只有英文问题）；
 * - 时间列显式 precision: 3，与 migrations/0025_nce_lessons.sql 的 DATETIME(3) 对齐。
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

@Entity('nce_lessons')
@Index('uk_nce_lessons_book_no', ['book', 'lesson_no'], { unique: true })
export class NceLessonEntity {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ type: 'varchar', length: 16, default: 'NCE2', comment: '册别' })
  book: string;

  @Column({ type: 'varchar', length: 128, default: '', comment: '教材名' })
  book_title: string;

  @Column({ type: 'int', unsigned: true, comment: '课号（对应 lessons.json 的 id）' })
  lesson_no: number;

  @Column({ type: 'varchar', length: 255, default: '', comment: '英文标题' })
  title: string;

  @Column({ type: 'varchar', length: 255, nullable: true, comment: '中文标题' })
  title_cn: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '英文导入问题' })
  lead_question: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true, comment: '中文导入问题' })
  lead_question_zh: string | null;

  @Column({ type: 'mediumtext', nullable: true, comment: '英文课文全文' })
  text: string | null;

  @Column({ type: 'varchar', length: 16, default: 'lrc', comment: '课文来源 xdf / lrc' })
  text_source: string;

  @Column({ type: 'json', nullable: true, comment: '逐句双语 [{en,cn}]' })
  lines: NceLine[] | null;

  @Column({ type: 'mediumtext', nullable: true, comment: '连贯参考译文' })
  translation: string | null;

  @Column({ type: 'json', nullable: true, comment: '生词表' })
  words: NceWord[] | null;

  @Column({ type: 'json', nullable: true, comment: '习题' })
  exercises: NceExercise[] | null;

  @Column({ type: 'json', nullable: true, comment: '来源 URL 数组' })
  sources: string[] | null;

  @Column({ type: 'datetime', precision: 3, nullable: true, comment: '抓取时间' })
  fetched_at: Date | null;

  @CreateDateColumn({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', comment: '创建时间' })
  created_at: Date;

  @Column({ type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)', onUpdate: 'CURRENT_TIMESTAMP(3)', comment: '更新时间' })
  updated_at: Date;
}
