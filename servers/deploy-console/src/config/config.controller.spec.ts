/**
 * 内部下发接口（`GET /api/config/internal/dispatch/:serviceKey`）：
 * 流水线 `restart` 动作脚本据此把配置中心的结果落盘 `.env.generated`
 * （`specs/service-config-delivery/design.md` §7 P1）。
 *
 * 只锁「鉴权 + 按需 + 返回码语义」三件事：
 * - 未配置 INTERNAL_API_KEY / 密钥不符 → 401
 * - 无 module 级条目 / 无键可下发 → 204（脚本保留现状，不凭空落盘）
 * - 有键 → 200 text/plain，正文即为下发文件内容
 */
import { Test } from '@nestjs/testing';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { AuditService } from '../audit/audit.service';
import { InternalGuardService } from '../common/internal-guard.service';

/** 最小 res 桩：记录 status / body / 是否 end */
function resStub() {
  const res: any = {
    statusCode: undefined,
    body: undefined,
    ended: false,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    type() {
      return res;
    },
    send(b: string) {
      res.body = b;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res;
}

const KEY = 'internal-key-for-test';

describe('ConfigController.dispatch（内部下发接口）', () => {
  let controller: ConfigController;
  let configService: {
    hasModuleScope: jest.Mock;
    dispatchPayload: jest.Mock;
    /** 2026-10-10：下发记录（P0-3） */
    recordDelivery: jest.Mock;
    reportDelivery: jest.Mock;
    listDeliveries: jest.Mock;
    listRevisions: jest.Mock;
    rollbackToRevision: jest.Mock;
  };
  const originalKey = process.env.INTERNAL_API_KEY;

  beforeAll(() => {
    process.env.INTERNAL_API_KEY = KEY;
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = originalKey;
  });

  beforeEach(async () => {
    configService = {
      hasModuleScope: jest.fn().mockResolvedValue(true),
      dispatchPayload: jest.fn().mockResolvedValue([
        { key: 'GATEWAY_SERVICE_KEY', value: 'svc-key-123', scope: 'module:local/gateway' },
      ]),
      recordDelivery: jest.fn().mockResolvedValue(undefined),
      reportDelivery: jest.fn().mockResolvedValue({
        drift: false,
        deliveryId: 'dl-1',
        expectedHash: null,
      }),
      listDeliveries: jest.fn().mockResolvedValue([]),
      listRevisions: jest.fn().mockResolvedValue([]),
      rollbackToRevision: jest.fn().mockResolvedValue({ key: 'A', scope: 'global' }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        // 诊断 #7：内部接口统一走 InternalGuardService（限流 + 白名单 + 审计）
        {
          provide: InternalGuardService,
          useValue: new InternalGuardService(
            { get: () => undefined } as never,
            { log: jest.fn().mockResolvedValue(undefined) } as never,
          ),
        },
      ],
    }).compile();
    controller = moduleRef.get(ConfigController);
  });

  const reqOf = (key?: string) => ({ headers: key ? { 'x-internal-key': key } : {} });

  it('缺少/错误的 x-internal-key → 401', async () => {
    await expect(controller.dispatch('gateway', 'local', reqOf(), resStub())).rejects.toThrow();
    await expect(controller.dispatch('gateway', 'local', reqOf('wrong'), resStub())).rejects.toThrow();
    expect(configService.dispatchPayload).not.toHaveBeenCalled();
  });

  it('envId 缺失 → 400', async () => {
    await expect(controller.dispatch('gateway', '', reqOf(KEY), resStub())).rejects.toThrow();
  });

  it('无 module 级条目 → 204（按需跳过，脚本保留现状）', async () => {
    configService.hasModuleScope.mockResolvedValue(false);
    const res = resStub();
    await controller.dispatch('todo-service', 'local', reqOf(KEY), res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(configService.dispatchPayload).not.toHaveBeenCalled();
  });

  it('可下发的键为空 → 204', async () => {
    configService.dispatchPayload.mockResolvedValue([]);
    const res = resStub();
    await controller.dispatch('gateway', 'local', reqOf(KEY), res);
    expect(res.statusCode).toBe(204);
  });

  it('有键 → 200 + 纯文本正文（含来源作用域注释，可直接写文件）', async () => {
    const res = resStub();
    await controller.dispatch('gateway', 'local', reqOf(KEY), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('# [module:local/gateway]');
    expect(res.body).toContain('GATEWAY_SERVICE_KEY=svc-key-123');
    expect(res.body).toContain('# 服务: gateway');
  });

  // ═══════ 2026-10-10：下发记录（P0-3）═══════

  it('成功下发要落记录：delivered + 键数 + 内容 hash', async () => {
    const res = resStub();
    await controller.dispatch('gateway', 'local', reqOf(KEY), res);

    expect(configService.recordDelivery).toHaveBeenCalledTimes(1);
    const arg = configService.recordDelivery.mock.calls[0][0];
    expect(arg.result).toBe('delivered');
    expect(arg.keyCount).toBe(1);
    expect(arg.envId).toBe('local');
    expect(arg.moduleKey).toBe('gateway');
    // hash 必须与实际正文一致，否则目标机回执永远判成漂移
    expect(arg.contentHash).toHaveLength(64);
    expect(arg.emptyReason).toBeFalsy();
  });

  it('204 也要落记录，且写明原因 —— 否则「配了没生效」无从查起', async () => {
    configService.hasModuleScope.mockResolvedValue(false);
    await controller.dispatch('todo-service', 'local', reqOf(KEY), resStub());

    const arg = configService.recordDelivery.mock.calls[0][0];
    expect(arg.result).toBe('empty');
    expect(arg.emptyReason).toBe('no-module-scope');
    expect(arg.keyCount).toBe(0);
  });

  it('有 module 级条目但没有可下发键 → empty 原因是 no-deliverable-key', async () => {
    configService.dispatchPayload.mockResolvedValue([]);
    await controller.dispatch('gateway', 'local', reqOf(KEY), resStub());

    const arg = configService.recordDelivery.mock.calls[0][0];
    expect(arg.result).toBe('empty');
    expect(arg.emptyReason).toBe('no-deliverable-key');
  });

  describe('目标机回执（内部上报接口）', () => {
    it('envId / moduleKey 缺失 → 400', async () => {
      await expect(
        controller.reportDelivery({ moduleKey: 'x', contentHash: 'a'.repeat(64) }, reqOf(KEY)),
      ).rejects.toThrow();
      await expect(
        controller.reportDelivery({ envId: 'local', contentHash: 'a'.repeat(64) }, reqOf(KEY)),
      ).rejects.toThrow();
    });

    it('hash 不是 sha256（64 位 hex）→ 400', async () => {
      await expect(
        controller.reportDelivery({ envId: 'local', moduleKey: 'x', contentHash: 'abc' }, reqOf(KEY)),
      ).rejects.toThrow();
    });

    it('合法上报走 internalGuard，返回结果含 drift 判定', async () => {
      configService.reportDelivery.mockResolvedValue({
        drift: true,
        deliveryId: 'dl-9',
        expectedHash: 'b'.repeat(64),
      });
      await expect(
        controller.reportDelivery(
          { envId: 'local', moduleKey: 'gateway', contentHash: 'a'.repeat(64) },
          reqOf(KEY),
        ),
      ).resolves.toEqual({ drift: true, deliveryId: 'dl-9', expectedHash: 'b'.repeat(64) });
    });

    it('缺少 x-internal-key → 401', async () => {
      await expect(
        controller.reportDelivery(
          { envId: 'local', moduleKey: 'gateway', contentHash: 'a'.repeat(64) },
          reqOf(),
        ),
      ).rejects.toThrow();
    });
  });
});
