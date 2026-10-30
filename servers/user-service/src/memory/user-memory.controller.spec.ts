import { UserMemoryController } from './user-memory.controller';
import { UserMemoryService } from './user-memory.service';
import { UserMemorySummaryService } from './user-memory-summary.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Request } from 'express';

/**
 * UserMemoryController 单测（#8229 跟进口径：C 端用户可自己改记忆）：
 * ①编辑成功内容落库 + 返回更新条目 ②越权/不存在 → 404（不区分以免探测）
 * ③空内容 → 400 ④超 500 字 → 400 ⑤编辑后触发 rebuild（失败不抛）
 * ⑥删除后触发 rebuild（删除失败不触发）
 */
describe('UserMemoryController', () => {
  const req = { user: { id: 'u1' } } as unknown as Request;
  const updatedRow = { id: 5, category: 'fact', content: '新内容', confidence: 1, createdAt: new Date() };

  function setup() {
    const memory = {
      list: jest.fn(),
      remove: jest.fn().mockResolvedValue(true),
      update: jest.fn().mockResolvedValue({ ok: true, row: updatedRow }),
    } as unknown as UserMemoryService;
    const summary = {
      get: jest.fn(),
      rebuild: jest.fn().mockResolvedValue({ changed: true, skipped: false, row: null }),
    } as unknown as UserMemorySummaryService;
    const controller = new UserMemoryController(memory, summary);
    return { controller, memory, summary };
  }

  /** flush fire-and-forget 的 rebuild 微任务 */
  async function flush() {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  it('①编辑成功：内容 trim 后落库、返回更新后的条目，并触发摘要 rebuild', async () => {
    const { controller, memory, summary } = setup();
    const res = await controller.edit(req, '5', { content: '  新内容  ' });
    expect(memory.update).toHaveBeenCalledWith('u1', 5, '新内容');
    expect(res).toEqual({ success: true, memory: updatedRow });
    await flush();
    expect(summary.rebuild).toHaveBeenCalledWith('u1');
  });

  it('②越权/不存在统一 404「记忆不存在」（不区分以免探测）', async () => {
    const { controller, memory } = setup();
    (memory.update as jest.Mock).mockResolvedValue({ ok: false, reason: 'not_found' });
    await expect(controller.edit(req, '5', { content: '新内容' })).rejects.toThrow(
      new NotFoundException('记忆不存在'),
    );
    // 归属隔离在 service 层由 findOne({ id, userId }) 保证，controller 只认 ok 语义
    expect(memory.update).toHaveBeenCalledWith('u1', 5, '新内容');
  });

  it('③空内容 → 400「记忆内容不能为空」，且不触达 service', async () => {
    const { controller, memory } = setup();
    for (const bad of [{ content: '' }, { content: '   ' }, {}, { content: 123 as unknown as string }]) {
      await expect(controller.edit(req, '5', bad)).rejects.toThrow(
        new BadRequestException('记忆内容不能为空'),
      );
    }
    expect(memory.update).not.toHaveBeenCalled();
  });

  it('④超 500 字 → 400「记忆内容不超过 500 字」（按字数不按 UTF-16 码元）', async () => {
    const { controller, memory } = setup();
    const exactly500 = '长'.repeat(500);
    await expect(controller.edit(req, '5', { content: exactly500 })).resolves.toBeDefined();
    const over = '长'.repeat(501);
    await expect(controller.edit(req, '5', { content: over })).rejects.toThrow(
      new BadRequestException('记忆内容不超过 500 字'),
    );
    expect(memory.update).toHaveBeenCalledTimes(1); // 只有 500 字那次通过
  });

  it('⑤编辑后 rebuild 失败不影响编辑响应（fire-and-forget + catch）', async () => {
    const { controller, summary } = setup();
    (summary.rebuild as jest.Mock).mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(controller.edit(req, '5', { content: '新内容' })).resolves.toBeDefined();
    await flush();
    expect(summary.rebuild).toHaveBeenCalledWith('u1');
  });

  it('⑤b 内容与同分类既有条目撞车 → 400（避免唯一键冲突 500）', async () => {
    const { controller, memory } = setup();
    (memory.update as jest.Mock).mockResolvedValue({ ok: false, reason: 'conflict' });
    await expect(controller.edit(req, '5', { content: '重复内容' })).rejects.toThrow(
      new BadRequestException('已存在相同内容的记忆'),
    );
  });

  it('⑥删除成功后触发 rebuild；删除不存在（404）不触发；rebuild 失败不抛', async () => {
    const { controller, memory, summary } = setup();
    await controller.remove(req, '5');
    await flush();
    expect(summary.rebuild).toHaveBeenCalledTimes(1);

    (memory.remove as jest.Mock).mockResolvedValue(false);
    await expect(controller.remove(req, '5')).rejects.toThrow(new NotFoundException('记忆不存在'));
    expect(summary.rebuild).toHaveBeenCalledTimes(1); // 未增加

    (memory.remove as jest.Mock).mockResolvedValue(true);
    (summary.rebuild as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(controller.remove(req, '5')).resolves.toBeDefined();
    await flush();
  });

  it('非法 id（非正整数）→ 404，不触达 service', async () => {
    const { controller, memory } = setup();
    await expect(controller.edit(req, 'abc', { content: 'x' })).rejects.toThrow(NotFoundException);
    expect(memory.update).not.toHaveBeenCalled();
  });
});
