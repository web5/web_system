import {
  ConfigAuditWatchService,
  diffConfigAudit,
  type ConfigRevisionRow,
} from './config-audit-watch.service';
import { valueFingerprint } from '../config/config.service';

type Any = never;

/**
 * 直写库检测单测（半发布治理 F3，03 号文 S2）。
 *
 * 变异思维：旧行为下直写库改值与正规通道改值在 config_items 里**长得一模一样**，
 * 唯一区分面是 config_revisions 有没有对应修订 —— 以下用例逐条锁住这个区分面。
 */
const item = (key: string, value: string, scope = 'module', envId = 'prod', moduleKey = 'auth-service') => ({
  scope,
  envId,
  moduleKey,
  key,
  value,
});
const rev = (
  key: string,
  action: string,
  afterValue: string | null,
  scope = 'module',
  envId = 'prod',
  moduleKey = 'auth-service',
): ConfigRevisionRow => ({
  scope,
  envId,
  moduleKey,
  key,
  action,
  afterFingerprint: afterValue === null ? null : valueFingerprint(afterValue),
});

describe('diffConfigAudit（直写库检测纯函数）', () => {
  it('正规变更（有修订且指纹一致）→ 零误报', () => {
    const diffs = diffConfigAudit(
      [item('JWT_SECRET', 'cipher-x')],
      new Map([['module|prod|auth-service|JWT_SECRET', rev('JWT_SECRET', 'update', 'cipher-x')]]),
    );
    expect(diffs).toEqual([]);
  });

  it('行存在但无任何修订（11-12 13:51 直写新增形态）→ unaudited-row', () => {
    const diffs = diffConfigAudit([item('DEPLOY_ENV_ID', 'prod')], new Map());
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe('unaudited-row');
  });

  it('最新修订是 delete 但行复活 → resurrected-row', () => {
    const diffs = diffConfigAudit(
      [item('OLD_KEY', 'v1')],
      new Map([['module|prod|auth-service|OLD_KEY', rev('OLD_KEY', 'delete', null)]]),
    );
    expect(diffs[0].kind).toBe('resurrected-row');
  });

  it('值指纹与最新修订不符（直写改值）→ value-drift；密钥密文口径一致', () => {
    const diffs = diffConfigAudit(
      [item('JWT_SECRET', 'cipher-tampered')],
      new Map([['module|prod|auth-service|JWT_SECRET', rev('JWT_SECRET', 'update', 'cipher-x')]]),
    );
    expect(diffs[0].kind).toBe('value-drift');
  });

  it('有修订但行已被删（直写删除）→ unaudited-delete', () => {
    const diffs = diffConfigAudit(
      [],
      new Map([['module|prod|auth-service|JWT_SECRET', rev('JWT_SECRET', 'create', 'cipher-x')]]),
    );
    expect(diffs[0].kind).toBe('unaudited-delete');
  });

  it('正规删除（有 delete 修订且行不在）→ 不误报', () => {
    const diffs = diffConfigAudit(
      [],
      new Map([['module|prod|auth-service|JWT_SECRET', rev('JWT_SECRET', 'delete', null)]]),
    );
    expect(diffs).toEqual([]);
  });
});

describe('ConfigAuditWatchService.check（组装与报告）', () => {
  function makeSvc(opts: { items?: unknown[]; revisions?: unknown[] }) {
    const local = {
      query: jest.fn(async (sql: string) =>
        sql.includes('FROM config_items') ? opts.items ?? [] : opts.revisions ?? [],
      ),
    };
    const svc = new ConfigAuditWatchService({ get: () => undefined } as Any, local as Any);
    return { svc, local };
  }

  it('全量一致 → ok', async () => {
    const { svc } = makeSvc({
      items: [{ scope: 'global', envId: '', moduleKey: '', key: 'A', value: '1' }],
      revisions: [
        { scope: 'global', envId: '', moduleKey: '', key: 'A', action: 'create', afterFingerprint: valueFingerprint('1') },
      ],
    });
    const r = await svc.check();
    expect(r.status).toBe('ok');
    expect(r.checkedRows).toBe(1);
  });

  it('混合场景：无修订行 + 指纹漂移同时检出；lastReport 可查', async () => {
    const { svc } = makeSvc({
      items: [
        { scope: 'module', envId: 'prod', moduleKey: 'auth-service', key: 'B', value: 'x' },
        { scope: 'module', envId: 'prod', moduleKey: 'auth-service', key: 'C', value: 'tampered' },
      ],
      revisions: [
        { scope: 'module', envId: 'prod', moduleKey: 'auth-service', key: 'C', action: 'update', afterFingerprint: valueFingerprint('orig') },
      ],
    });
    const r = await svc.check();
    expect(r.status).toBe('drift');
    expect(r.diffs.map((d) => d.kind).sort()).toEqual(['unaudited-row', 'value-drift']);
    expect(svc.lastReport()?.status).toBe('drift');
  });

  it('查询异常 → error 报告（不抛给定时器）', async () => {
    const local = { query: jest.fn(async () => { throw new Error('DB 不可达'); }) };
    const svc = new ConfigAuditWatchService({ get: () => undefined } as Any, local as Any);
    const r = await svc.check();
    expect(r.status).toBe('error');
  });
});
