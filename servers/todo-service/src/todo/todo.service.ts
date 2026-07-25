import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Todo } from './todo.entity';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { QueryTodoDto } from './dto/query-todo.dto';

/** 允许的排序字段白名单 — 防止 SQL 注入 */
const ALLOWED_SORT_FIELDS = new Set([
  'id', 'title', 'status', 'priority', 'category',
  'due_date', 'created_at', 'updated_at', 'completed_at',
]);

@Injectable()
export class TodoService {
  constructor(
    @InjectRepository(Todo)
    private todoRepository: Repository<Todo>,
  ) {}

  async findAll(query: QueryTodoDto, userId: number) {
    const { page = 1, pageSize = 20, status, priority, category, keyword, sortBy = 'created_at', sortOrder = 'desc' } = query;
    const skip = (page - 1) * pageSize;

    const qb = this.todoRepository
      .createQueryBuilder('todo')
      .where('todo.user_id = :userId', { userId })
      .andWhere('todo.deleted_at IS NULL');

    // 排序字段白名单校验 — 防止 SQL 注入
    if (!ALLOWED_SORT_FIELDS.has(sortBy)) {
      throw new BadRequestException(`不允许的排序字段: ${sortBy}`);
    }

    if (status) {
      qb.andWhere('todo.status = :status', { status });
    }
    if (priority) {
      qb.andWhere('todo.priority = :priority', { priority });
    }
    if (category) {
      qb.andWhere('JSON_CONTAINS(todo.category, :category)', { category: `"${category}"` });
    }
    if (keyword) {
      qb.andWhere('todo.title LIKE :keyword', { keyword: `%${keyword}%` });
    }

    qb.orderBy(`todo.${sortBy}`, sortOrder.toUpperCase() as 'ASC' | 'DESC')
      .skip(skip)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async findOne(id: number, userId: number): Promise<Todo> {
    const todo = await this.todoRepository.findOne({
      where: { id, user_id: userId, deleted_at: null },
    });
    if (!todo) throw new NotFoundException('Task not found');
    return todo;
  }

  async create(createTodoDto: CreateTodoDto, userId: number): Promise<Todo> {
    const todo = this.todoRepository.create({
      ...createTodoDto,
      user_id: userId,
      due_date: createTodoDto.due_date ? new Date(createTodoDto.due_date) : undefined,
    });
    return this.todoRepository.save(todo);
  }

  async update(id: number, updateTodoDto: UpdateTodoDto, userId: number): Promise<Todo> {
    const todo = await this.findOne(id, userId);
    Object.assign(todo, {
      ...updateTodoDto,
      due_date: updateTodoDto.due_date ? new Date(updateTodoDto.due_date) : todo.due_date,
      completed_at: updateTodoDto.status === 'completed' ? new Date() : todo.completed_at,
    });
    return this.todoRepository.save(todo);
  }

  async remove(id: number, userId: number): Promise<void> {
    const todo = await this.findOne(id, userId);
    todo.deleted_at = new Date();
    await this.todoRepository.save(todo);
  }

  async updateStatus(id: number, status: string, userId: number): Promise<Todo> {
    const todo = await this.findOne(id, userId);
    todo.status = status as any;
    if (status === 'completed') todo.completed_at = new Date();
    return this.todoRepository.save(todo);
  }

  async getStats(userId: number, period: string = 'today') {
    const now = new Date();
    let startDate: Date;
    if (period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const [total, completed, overdue] = await Promise.all([
      this.todoRepository.count({ where: { user_id: userId, deleted_at: null } }),
      this.todoRepository.count({ where: { user_id: userId, status: 'completed', deleted_at: null } }),
      this.todoRepository.count({ where: { user_id: userId, status: 'overdue', deleted_at: null } }),
    ]);

    const pending = total - completed - overdue;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, pending, overdue, completionRate };
  }
}
