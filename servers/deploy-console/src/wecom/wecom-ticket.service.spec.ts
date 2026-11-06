import { createHmac } from 'crypto';
import { WecomTicketService } from './wecom-ticket.service';

const NOW = 1_700_000_000_000;
const svc = new WecomTicketService('test-secret');
const other = new WecomTicketService('another-secret');

describe('WecomTicketService（S3 / S4 / V9）', () => {
  describe('OAuth state', () => {
    it('签出的 state 可验回原审批单', () => {
      const state = svc.signState('A1', NOW);
      expect(svc.verifyState(state, NOW)).toMatchObject({ approvalId: 'A1', ts: NOW });
    });

    it('超过 10 分钟返回 null', () => {
      const state = svc.signState('A1', NOW);
      expect(svc.verifyState(state, NOW + 601_000)).toBeNull();
    });

    it('未来时间戳（时钟漂移 >1min）返回 null', () => {
      const state = svc.signState('A1', NOW + 120_000);
      expect(svc.verifyState(state, NOW)).toBeNull();
    });

    it('换密钥 / 篡改内容一律验不过', () => {
      const state = svc.signState('A1', NOW);
      expect(other.verifyState(state, NOW)).toBeNull();
      expect(svc.verifyState(state + 'x', NOW)).toBeNull();
      expect(svc.verifyState('garbage', NOW)).toBeNull();
    });
  });

  describe('scope=approve 短令牌', () => {
    const args = { sub: 'bob', ext: 'wenzhui', approvalId: 'A1' };

    it('正常签发可验回 sub / ext / approvalId', () => {
      const token = svc.issueApproveTicket(args, NOW);
      expect(svc.verifyApproveTicket(token, NOW)).toMatchObject({
        scope: 'approve', sub: 'bob', ext: 'wenzhui', approvalId: 'A1',
      });
    });

    it('15 分钟到期后返回 null（V9）', () => {
      const token = svc.issueApproveTicket(args, NOW);
      expect(svc.verifyApproveTicket(token, NOW + 899_000)).not.toBeNull();
      expect(svc.verifyApproveTicket(token, NOW + 900_000)).toBeNull();
    });

    it('换密钥签发的令牌验不过', () => {
      expect(svc.verifyApproveTicket(other.issueApproveTicket(args, NOW), NOW)).toBeNull();
    });

    it('signed-link 令牌不能当 approve 短令牌用', () => {
      const link = svc.issueSignedLink('A1', NOW);
      expect(svc.verifyApproveTicket(link, NOW)).toBeNull();
    });
  });

  /**
   * 读写窗口分离（14 号方案 §五）。
   * 写窗口 15min 不放宽；读窗口 2h，覆盖「批完去开会、回来再看一眼发布结果」。
   */
  describe('scope=approve 读写窗口分离', () => {
    const args = { sub: 'bob', ext: 'wenzhui', approvalId: 'A1' };

    it('16 分钟后写模式失效、读模式仍有效', () => {
      const token = svc.issueApproveTicket(args, NOW);
      const at16min = NOW + 16 * 60_000;
      expect(svc.verifyApproveTicket(token, at16min, 'write')).toBeNull();
      expect(svc.verifyApproveTicket(token, at16min, 'read')).not.toBeNull();
    });

    it('不传 mode 等同于写模式（默认必须严）', () => {
      const token = svc.issueApproveTicket(args, NOW);
      expect(svc.verifyApproveTicket(token, NOW + 16 * 60_000)).toBeNull();
    });

    it('超过 2 小时读模式也失效', () => {
      const token = svc.issueApproveTicket(args, NOW);
      expect(svc.verifyApproveTicket(token, NOW + 2 * 60 * 60_000 - 1, 'read')).not.toBeNull();
      expect(svc.verifyApproveTicket(token, NOW + 2 * 60 * 60_000, 'read')).toBeNull();
    });

    it('旧票（无 viewExp）读模式回落 exp，不因部署瞬间集体失效也不会被放宽', () => {
      // 手工按部署前的载荷格式签一张票：只有 exp，没有 viewExp
      const json = JSON.stringify({
        scope: 'approve', sub: 'bob', ext: 'wenzhui', approvalId: 'A1',
        iat: NOW, exp: NOW + WecomTicketService.APPROVE_TTL_SEC * 1000,
      });
      const body = Buffer.from(json, 'utf8').toString('base64url');
      const sig = createHmac('sha256', 'test-secret').update(json).digest('hex');
      const legacy = `${body}.${sig}`;

      expect(svc.verifyApproveTicket(legacy, NOW + 14 * 60_000, 'read')).not.toBeNull();
      expect(svc.verifyApproveTicket(legacy, NOW + 16 * 60_000, 'read')).toBeNull();
    });
  });

  describe('A 模式签名链接', () => {
    it('有效 / 过期 / 无效三态可区分', () => {
      const link = svc.issueSignedLink('A1', NOW);
      expect(svc.verifySignedLink(link, NOW)).toEqual({ ok: true, approvalId: 'A1' });
      expect(svc.verifySignedLink(link, NOW + 901_000)).toEqual({ ok: false, reason: 'expired' });
      expect(svc.verifySignedLink('bad', NOW)).toEqual({ ok: false, reason: 'invalid' });
    });
  });
});
