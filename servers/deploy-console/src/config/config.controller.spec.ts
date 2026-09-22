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
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
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
});
