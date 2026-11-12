import { PointerReconcileService, diffPointerTriple, type PointerTriple } from './pointer-reconcile.service';

type Any = never;

/**
 * 三方对账巡检单测（半发布治理 F2，05a 专项 P0-2）。
 *
 * 变异思维：旧的 consistency-watch 只比两张 DB 表 —— 11-09 形态（盘新表无行）
 * 在旧判据下两表完全一致，蒙混过关。以下用例封死各撕裂形态。
 */

function triple(partial: Partial<PointerTriple> & { app?: string; env?: string }): PointerTriple {
  const side = (raw: string | null, applicable: boolean, commit?: string | null) => ({
    raw,
    applicable,
    commit: commit !== undefined ? commit : raw,
  });
  return {
    app: partial.app ?? 'portal',
    env: partial.env ?? 'prod',
    disk: partial.disk ?? side(null, true),
    table: partial.table ?? side(null, true),
    manifest: partial.manifest ?? side(null, true),
  };
}

describe('diffPointerTriple（三方对账纯函数）', () => {
  it('三方一致（含拼写差归一）→ 无漂移', () => {
    expect(
      diffPointerTriple(
        triple({
          disk: { raw: 'abc1234', commit: 'abc1234', applicable: true },
          table: { raw: 'portal/abc1234', commit: 'abc1234', applicable: true },
          manifest: { raw: 'abc1234', commit: 'abc1234', applicable: true },
        }),
      ),
    ).toBe(null);
  });

  it('11-09 形态：盘有值、表无行 → side-missing', () => {
    const d = diffPointerTriple(
      triple({
        disk: { raw: 'abc1234', commit: 'abc1234', applicable: true },
        table: { raw: null, commit: null, applicable: true },
        manifest: { raw: null, commit: null, applicable: true },
      }),
    );
    expect(d?.kind).toBe('side-missing');
  });

  it('路径 C 形态：表有值、盘缺失（只写表不写盘）→ side-missing', () => {
    const d = diffPointerTriple(
      triple({
        disk: { raw: null, commit: null, applicable: true },
        table: { raw: 'abc1234', commit: 'abc1234', applicable: true },
      }),
    );
    expect(d?.kind).toBe('side-missing');
  });

  it('盘与表都有值但不一致 → value-mismatch', () => {
    const d = diffPointerTriple(
      triple({
        disk: { raw: 'abc1234', commit: 'abc1234', applicable: true },
        table: { raw: 'def5678', commit: 'def5678', applicable: true },
        manifest: { raw: 'def5678', commit: 'def5678', applicable: true },
      }),
    );
    expect(d?.kind).toBe('value-mismatch');
  });

  it('manifest 与表不一致（直写库未走正规通道）→ value-mismatch', () => {
    const d = diffPointerTriple(
      triple({
        disk: { raw: 'abc1234', commit: 'abc1234', applicable: true },
        table: { raw: 'abc1234', commit: 'abc1234', applicable: true },
        manifest: { raw: 'zzz9999', commit: 'zzz9999', applicable: true },
      }),
    );
    expect(d?.kind).toBe('value-mismatch');
  });

  it('全部无值（未部署）→ 不算漂移', () => {
    expect(diffPointerTriple(triple({}))).toBe(null);
  });

  it('CDN 模式：盘侧不适用，表↔manifest 两方对账', () => {
    expect(
      diffPointerTriple(
        triple({
          disk: { raw: null, commit: null, applicable: false },
          table: { raw: 'abc1234', commit: 'abc1234', applicable: true },
          manifest: { raw: 'abc1234', commit: 'abc1234', applicable: true },
        }),
      ),
    ).toBe(null);
  });

  it('只剩单侧可判（CDN + manifest 取不到）→ 无从对账，不判漂移', () => {
    expect(
      diffPointerTriple(
        triple({
          disk: { raw: null, commit: null, applicable: false },
          table: { raw: 'abc1234', commit: 'abc1234', applicable: true },
          manifest: { raw: null, commit: null, applicable: false },
        }),
      ),
    ).toBe(null);
  });
});

describe('PointerReconcileService.check（编排与降级）', () => {
  function makeSvc(opts: {
    pairs?: Array<{ app: string; env: string }>;
    tableRows?: Array<{ app: string; env: string; v: string | null }>;
    disk?: Record<string, string | null>;
    cdn?: boolean;
    gatewayUrl?: string;
    manifest?: Record<string, unknown> | null;
    diskThrows?: boolean;
  }) {
    const cfg = { get: (k: string) => (k === 'CDN_LAYOUT_MODE' ? (opts.cdn ? 'cdn' : undefined) : undefined) };
    const local = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('deploy_apps')) return opts.pairs ?? [{ app: 'portal', env: 'prod' }];
        return opts.tableRows ?? [];
      }),
    };
    const artifacts = {
      readPointer: jest.fn(async (env: string, app: string) => {
        if (opts.diskThrows) throw new Error('ssh 不可达');
        return opts.disk?.[`${app}@${env}`] ?? null;
      }),
    };
    const gatewayCache = { urlFor: jest.fn(() => opts.gatewayUrl ?? '') };
    const probe = { fetchGatewayManifest: jest.fn(async () => opts.manifest ?? null) };
    const svc = new PointerReconcileService(
      cfg as Any,
      local as Any,
      artifacts as Any,
      gatewayCache as Any,
      probe as Any,
    );
    return { svc, artifacts, probe };
  }

  it('盘新表无行（11-09）→ drift 且 diff 含三方原始值', async () => {
    const { svc } = makeSvc({
      tableRows: [],
      disk: { 'portal@prod': 'abc1234' },
      gatewayUrl: 'http://gw',
      manifest: { byEnv: { prod: {} } },
    });
    const r = await svc.check();
    expect(r.status).toBe('drift');
    expect(r.diffs[0].kind).toBe('side-missing');
    expect(r.diffs[0].disk.raw).toBe('abc1234');
    expect(r.diffs[0].table.raw).toBe(null);
  });

  it('三方一致 → ok，checkedPairs 计数正确', async () => {
    const { svc } = makeSvc({
      tableRows: [{ app: 'portal', env: 'prod', v: 'portal/abc1234' }],
      disk: { 'portal@prod': 'abc1234' },
      gatewayUrl: 'http://gw',
      manifest: { byEnv: { prod: { portal: { version: 'abc1234' } } } },
    });
    const r = await svc.check();
    expect(r.status).toBe('ok');
    expect(r.checkedPairs).toBe(1);
    expect(r.diffs).toEqual([]);
  });

  it('CDN 模式不读盘指针；表↔manifest 两方对账', async () => {
    const { svc, artifacts } = makeSvc({
      cdn: true,
      tableRows: [{ app: 'portal', env: 'prod', v: 'abc1234' }],
      gatewayUrl: 'http://gw',
      manifest: { byEnv: { prod: { portal: { version: 'abc1234' } } } },
    });
    const r = await svc.check();
    expect(artifacts.readPointer).not.toHaveBeenCalled();
    expect(r.status).toBe('ok');
  });

  it('gateway 未配置：manifest 侧不适用，盘↔表仍可判漂移', async () => {
    const { svc, probe } = makeSvc({
      tableRows: [{ app: 'portal', env: 'prod', v: 'abc1234' }],
      disk: { 'portal@prod': 'def5678' },
    });
    const r = await svc.check();
    expect(probe.fetchGatewayManifest).not.toHaveBeenCalled();
    expect(r.status).toBe('drift');
    expect(r.diffs[0].kind).toBe('value-mismatch');
  });

  it('读盘失败按缺失处理，不拖垮整轮（表有值 → side-missing 漂移）', async () => {
    const { svc } = makeSvc({
      diskThrows: true,
      tableRows: [{ app: 'portal', env: 'prod', v: 'abc1234' }],
    });
    const r = await svc.check();
    expect(r.status).toBe('drift');
  });
});
