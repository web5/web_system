import { ContractConversationService } from './contract-conversation.service';
import { AgentConversation } from '../agent/memory/agent-conversation.entity';
import { Repository } from 'typeorm';

const REPORT_FINAL =
  '{"scene":"消费贷款","conclusion":"结论","signals":[{"level":"danger"},{"level":"warn"},{"level":"ok"}]}';

describe('ContractConversationService', () => {
  function setup() {
    const repo = {
      create: jest.fn((e) => e),
      save: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    } as unknown as Repository<AgentConversation>;
    const svc = new ContractConversationService(repo);
    return { repo, svc };
  }

  it('报告 final → 按 {id,userId} 写入 report/meta/title', async () => {
    const { repo, svc } = setup();
    await svc.snapshotReport('u1', 'conv-1', REPORT_FINAL);
    expect(repo.save).toHaveBeenCalledTimes(1);
    const saved = (repo.save as jest.Mock).mock.calls[0][0];
    expect(saved.id).toBe('conv-1');
    expect(saved.userId).toBe('u1');
    expect(saved.title).toBe('合同体检 · 消费贷款');
    expect(saved.report.scene).toBe('消费贷款');
    expect(saved.meta).toEqual({ scene: '消费贷款', danger: 1, warn: 1, ok: 1 });
    // 不携带 messages（避免把记忆 messages 覆盖为空）
    expect(saved).not.toHaveProperty('messages');
  });

  it('追问普通文本 → 不触发 save（不覆盖既有快照）', async () => {
    const { repo, svc } = setup();
    await svc.snapshotReport('u1', 'conv-1', '违约金大约是 3%，您可以这样主张……');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('参数缺失 → no-op', async () => {
    const { repo, svc } = setup();
    await svc.snapshotReport('', 'conv-1', REPORT_FINAL);
    await svc.snapshotReport('u1', '', REPORT_FINAL);
    await svc.snapshotReport('u1', 'conv-1', '');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('repo.save 失败 → 吞异常不抛出（辅助链路不拖垮主链路）', async () => {
    const repo = {
      create: jest.fn((e) => e),
      save: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as Repository<AgentConversation>;
    const svc = new ContractConversationService(repo);
    await expect(svc.snapshotReport('u1', 'conv-1', REPORT_FINAL)).resolves.toBeUndefined();
  });
});
