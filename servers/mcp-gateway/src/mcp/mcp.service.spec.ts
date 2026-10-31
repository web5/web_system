/**
 * 回归锁：机构行为工具的 description 不许再写回「劝退」措辞（PR #521）。
 *
 * 事故链（2026-10 实测）：东财把 RPT_CYQ_DEFAULT / RPT_F10_FN_MAIN 两个报表下架后，
 * content-hub 的 get_chip / get_finance_yoy 永久返回 ok:false；mcp-gateway 的工具说明
 * 也被写成「该报表可能不可用 / 已下架（降级使用）」。**结果数据没人调**——
 * Agent 读 tools/list 的说明，看到「不可用」就直接绕开，连调用都不发。
 *
 * 于是数据源换成 RPT_LICO_FN_CPD + F10 股东研究之后，如果说明不跟着改，
 * 这次换源等于白修一半：数据在库里，Agent 不用。
 *
 * 本 spec 锁四件事：
 *   ① 声明改了就真会落库 —— syncModuleTools 有定义漂移检测（description/method/path/params
 *      任一不同即 UPDATE），**不需要删模块重建**。这条以前被误判成「改了也不生效」，
 *      正是放弃改说明的直接原因，所以要钉死。
 *   ② 9 条 description 都不许出现「可能不可用 / 已下架」这类劝退措辞。
 *   ③ get_chip 必须写明「不含获利盘比例、不是成本分布」——不写清楚，Agent 会把
 *      股东户数当筹码获利比例直接引用，比不返回更危险。
 *   ④ 声明没变时一条都不许写库（否则每次启动刷 UPDATE，updated_at 乱跳）。
 */
import { McpService } from './mcp.service';

/** mcp_modules 里 institution 模块的形状（seed 只读这几列） */
const MODULE = {
  id: 9,
  name: '机构行为数据',
  module_type: 'http',
  base_url: 'http://127.0.0.1:6007',
  auth_type: '',
  auth_config: null,
  enabled: true,
};

/** 与 INSTITUTION_HTTP_TOOLS 的 name 一一对应（数组本身未导出，故按行为断言） */
const TOOL_NAMES = [
  'get_quote',
  'get_north_holding',
  'get_fund_flow',
  'get_lhb',
  'get_rating',
  'get_report',
  'get_valuation',
  'get_chip',
  'get_finance_yoy',
];

/** 劝退措辞：出现任意一个，Agent 就会放弃调用这个工具 */
const DISCOURAGING = /可能不可用|已下架|不可用|暂时无法/;

type ToolRow = {
  id: number;
  module_id: number;
  name: string;
  description: string;
  method: string;
  path: string;
  params: unknown;
};

function makeService(toolRows: ToolRow[]) {
  // 形参显式声明：jest.fn(async () => …) 会被推成「无参」，mock.calls 取不到 [where, patch]
  const affected = async (_where: unknown, _patch: unknown) => ({ affected: 1 });
  const moduleRepo = {
    findOne: jest.fn(async () => ({ ...MODULE })),
    update: jest.fn(affected),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: unknown) => x),
  };
  const toolRepo = {
    find: jest.fn(async () => toolRows),
    update: jest.fn(affected),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: unknown) => x),
  };
  const svc = new McpService(moduleRepo as never, toolRepo as never, {} as never);
  return { svc, moduleRepo, toolRepo };
}

/** 跑一遍 institution seam，把落库的 (where, patch) 抓出来 */
async function seedPatches(toolRows: ToolRow[]) {
  const { svc, toolRepo } = makeService(toolRows);
  await (svc as unknown as { seedInstitutionModule(): Promise<void> }).seedInstitutionModule();
  return toolRepo.update.mock.calls.map((c) => ({
    where: c[0] as { module_id: number; name: string },
    patch: c[1] as { description: string; method: string; path: string; params: unknown },
  }));
}

/** 库里 9 条工具的旧文案（任意值都能被判成漂移，用于一次性抓到全部 9 条声明） */
function staleRows(): ToolRow[] {
  return TOOL_NAMES.map((name, i) => ({
    id: i + 1,
    module_id: MODULE.id,
    name,
    description: '旧文案（占位，确保被判成漂移）',
    method: 'GET',
    path: `/old/${name}`,
    params: [],
  }));
}

async function declaredDescriptions() {
  const patches = await seedPatches(staleRows());
  return new Map(patches.map((p) => [p.where.name, p.patch.description]));
}

describe('机构行为工具 description（PR #521 换源后的回归锁）', () => {
  it('description 变了就走 UPDATE 落库（不是 delete+insert，也不需要重建模块）', async () => {
    const { svc, toolRepo } = makeService(staleRows());
    await (svc as unknown as { seedInstitutionModule(): Promise<void> }).seedInstitutionModule();

    const names = toolRepo.update.mock.calls.map((c) => (c[0] as { name: string }).name);
    expect(names.sort()).toEqual([...TOOL_NAMES].sort());
    // 漂移同步只 update，不删不插
    expect(toolRepo.save).not.toHaveBeenCalled();
  });

  it('9 条 description 均不含「可能不可用 / 已下架」等劝退措辞', async () => {
    const patches = await seedPatches(staleRows());
    const offenders = patches
      .filter((p) => DISCOURAGING.test(p.patch.description))
      .map((p) => ({ name: p.where.name, description: p.patch.description }));

    expect(offenders).toEqual([]);
    // 顺带确认「9 条」不是空跑：少一条就说明有工具没被采集到
    expect(patches).toHaveLength(TOOL_NAMES.length);
  });

  it('get_chip 写明「代理指标」「不含获利盘比例」「不是成本分布」——不能只换个说法', async () => {
    const desc = (await declaredDescriptions()).get('get_chip') ?? '';

    expect(desc).toContain('代理指标');
    expect(desc).toContain('不含获利盘比例');
    expect(desc).toContain('不是成本分布');
    expect(desc).toContain('股东户数');
    // 老文案的「降级使用」也在劝退范围内，确认已去掉
    expect(desc).not.toContain('降级使用');
  });

  it('get_finance_yoy 写明数据源与返回字段（RPT_LICO_FN_CPD / labels / 同比）', async () => {
    const desc = (await declaredDescriptions()).get('get_finance_yoy') ?? '';

    expect(desc).toContain('RPT_LICO_FN_CPD');
    expect(desc).toContain('labels');
    expect(desc).toContain('归母净利润');
    expect(desc).toContain('同比');
    expect(desc).not.toContain('降级使用');
  });

  it('声明与库内一致时一条都不写库（避免每次启动刷 UPDATE）', async () => {
    const patches = await seedPatches(staleRows());
    const rows: ToolRow[] = patches.map((p, i) => ({
      id: i + 1,
      module_id: MODULE.id,
      name: p.where.name,
      description: p.patch.description,
      method: p.patch.method,
      path: p.patch.path,
      params: p.patch.params,
    }));

    const { svc, toolRepo } = makeService(rows);
    await (svc as unknown as { seedInstitutionModule(): Promise<void> }).seedInstitutionModule();

    expect(toolRepo.update).not.toHaveBeenCalled();
    expect(toolRepo.save).not.toHaveBeenCalled();
  });
});
