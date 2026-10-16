/**
 * 席位资金性质打标 —— 规则口径单测（p35 · CQO）。
 *
 * 为什么锁这里：席位归属必须**可复现**（同一只票今天判游资、明天判散户，
 * 龙虎榜数据就失去可比性 —— 取舍说明见 seat-tag.service.ts 头部注释）。
 * 名单由人在 admin 维护，所以这里锁的是规则本身的判定顺序与降级行为：
 *   ① 命中 hotmoney_seats 名单 → hotmoney
 *   ② 机构专用 / 沪深股通关键词 → institution
 *   ③ 其余营业部 → retail
 *   名单读失败 → 不抛错、本批不打游资标（数据可读优先于归属精确）
 */
import { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { SeatTagService } from './seat-tag.service';
import type { HotmoneySeatEntity } from '../entities/hotmoney-seat.entity';
import { SEAT_TAG } from '../quality/quality.enum';

const HOTMONEY_SEAT = '华鑫证券有限责任公司上海分公司';

function row(seatName: string, alias: string | null = '章盟主') {
  return {
    id: 1,
    seat_name: seatName,
    alias,
    tag: SEAT_TAG.HOTMONEY,
    is_active: 1,
  } as unknown as HotmoneySeatEntity;
}

/** repo 实际只用到 find —— 名单在表里，关键词规则在代码里 */
function makeService(rows: HotmoneySeatEntity[], impl?: jest.Mock) {
  const find = impl ?? jest.fn().mockResolvedValue(rows);
  const svc = new SeatTagService({ find } as unknown as Repository<HotmoneySeatEntity>);
  return { svc, find };
}

describe('SeatTagService', () => {
  it('命中游资名单 → hotmoney，并带回命中的别名', async () => {
    const { svc } = makeService([row(HOTMONEY_SEAT)]);
    const r = await svc.tagOne({ name: HOTMONEY_SEAT });
    expect(r.tag).toBe(SEAT_TAG.HOTMONEY);
    expect(r.matched_alias).toBe('章盟主');
    expect(r.reason).toContain('命中游资名单');
  });

  it('名单里的空格差异不影响命中（归一化去空白 + 小写）', async () => {
    const { svc } = makeService([row('银河证券股份有限公司绍兴证券营业部')]);
    const r = await svc.tagOne({ name: '银河证券股份有限公司 绍兴证券营业部' });
    expect(r.tag).toBe(SEAT_TAG.HOTMONEY);
  });

  it('名单优先于关键词规则：即便席位名含「机构专用」，在名单内仍判游资', async () => {
    const { svc } = makeService([row('机构专用')]);
    const r = await svc.tagOne({ name: '机构专用' });
    expect(r.tag).toBe(SEAT_TAG.HOTMONEY);
  });

  it('机构专用 / 沪深股通 → institution', async () => {
    const { svc } = makeService([]);
    for (const name of ['机构专用', '沪股通专用', '深股通专用']) {
      const r = await svc.tagOne({ name });
      expect(r.tag).toBe(SEAT_TAG.INSTITUTION);
      expect(r.matched_alias).toBeNull();
    }
  });

  it('未命中名单且非机构席位 → retail（不是空、不是未知）', async () => {
    const { svc } = makeService([]);
    const r = await svc.tagOne({ name: '某某证券股份有限公司某某营业部' });
    expect(r.tag).toBe(SEAT_TAG.RETAIL);
  });

  it('名单读失败 → 降级为空名单、不抛错，页面仍能拿到非游资判定', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const find = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { svc } = makeService([], find);
    const r = await svc.tagSeats([{ name: '银河证券股份有限公司绍兴证券营业部' }]);
    expect(r.details).toHaveLength(1);
    expect(r.details[0].tag).toBe(SEAT_TAG.RETAIL);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('空批次返回空结果，不查库', async () => {
    const { svc, find } = makeService([]);
    const r = await svc.tagSeats([]);
    expect(r).toEqual({ tags: [], details: [] });
    expect(find).not.toHaveBeenCalled();
  });

  it('tags 去重、无 name 的条目被跳过', async () => {
    const { svc } = makeService([row(HOTMONEY_SEAT), row('中信证券股份有限公司上海溧阳路')]);
    const r = await svc.tagSeats([
      { name: HOTMONEY_SEAT },
      { name: '中信证券股份有限公司上海溧阳路' },
      { buy: 1 } as unknown as { name: string },
    ]);
    expect(r.details).toHaveLength(2);
    expect(r.tags).toEqual([SEAT_TAG.HOTMONEY]);
  });

  it('名单有进程内缓存：只读一次；invalidateCache 后重读', async () => {
    const { svc, find } = makeService([row(HOTMONEY_SEAT)]);
    await svc.tagOne({ name: HOTMONEY_SEAT });
    await svc.tagOne({ name: HOTMONEY_SEAT });
    expect(find).toHaveBeenCalledTimes(1);
    svc.invalidateCache();
    await svc.tagOne({ name: HOTMONEY_SEAT });
    expect(find).toHaveBeenCalledTimes(2);
  });
});
