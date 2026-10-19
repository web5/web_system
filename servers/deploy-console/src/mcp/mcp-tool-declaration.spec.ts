import * as fs from 'fs';
import * as path from 'path';

/**
 * MCP 工具声明 ↔ 后端路由 的一致性守卫。
 *
 * 为什么需要这个测试：**同一个事实被写了两遍**。
 *  - deploy-console 的 `McpController` 决定"到底有哪些接口"；
 *  - mcp-gateway 的 `DEPLOY_HTTP_TOOLS` / `DEPLOY_JOB_TOOLS` 决定"Agent 在 tools/list 里看得到什么"。
 *
 * 两边没有编译期依赖（跨包、跨仓库也能各写各的），于是天然会漂移，且漂移是**静默**的：
 * 接口存在但没声明 → Agent 够不着，功能等于不存在（本次的 approve/reject 就是这个情况，
 * 控制台注释里白纸黑字写着"打通最后一公里"，网关却从来没声明过）；
 * 声明了但接口不存在 → Agent 一调就 404，而且是到了调用时才知道。
 *
 * 这个测试把漂移变成 CI 红灯，而不是"发布链路莫名其妙断在半路"。
 * 与 `config-layer-backfill.spec.ts` 同一手法：读文件 → 解析 → 双向比对。
 */

const GATEWAY_SRC = path.resolve(
  __dirname,
  '../../../../servers/mcp-gateway/src/mcp/mcp.service.ts',
);
const CONTROLLER_SRC = path.resolve(__dirname, './mcp.controller.ts');

/** 控制器前缀 `mcp` + 全局前缀 `api`（main.ts 的 setGlobalPrefix('api')） */
const ROUTE_PREFIX = 'api/mcp/';

interface Route {
  method: string;
  path: string;
}

/**
 * 抠出 `const NAME = [...]` 的整块文本。
 *
 * 必须跳过字符串里的括号：工具描述里写着 `{type:"percent",value:10}` 这种示例，
 * 朴素括号计数会被它带偏，直接把块截短。
 */
function extractConstBlock(src: string, constName: string): string {
  const start = src.indexOf(`const ${constName}`);
  if (start < 0) throw new Error(`未找到 const ${constName}（网关文件结构变了？）`);
  // ⚠️ 必须从 `=` 之后开始找 `[`，不能直接从 constName 之后找：
  // 类型标注 `HttpJobToolDef[]` 里的 `[]` 更早出现，会被误当成数组起始括号，
  // 结果是整个块被抠成 `[]` —— 声明"消失"，而下面的比对只会报"漏声明"，不会报解析失败。
  const eq = src.indexOf('=', start);
  const open = src.indexOf('[', eq);
  if (open < 0) throw new Error(`const ${constName} 后未找到 [`);

  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`const ${constName} 括号未闭合`);
}

/** 从声明块里抽出所有 `method: 'X', path: 'Y'` 对（同步工具与 job 的 submit/status/cancel 同构） */
function extractPairs(block: string): Route[] {
  const out: Route[] = [];
  for (const m of block.matchAll(/method:\s*'([A-Za-z]+)',\s*path:\s*'([^']+)'/g)) {
    out.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return out;
}

/** 路径归一化：`:jobId` 与 `{jobId}` 是同一个东西，都折成 `*`；顺带去掉开头的 / */
function normalize(p: string): string {
  return p
    .replace(/^\//, '')
    .replace(/[:{]([A-Za-z0-9_]+)}?/g, '*');
}

/** 控制器里声明的路由 */
function parseControllerRoutes(src: string): Route[] {
  const out: Route[] = [];
  for (const m of src.matchAll(/@(Post|Get|Delete|Put|Patch)\(\s*'([^']*)'\s*\)/g)) {
    out.push({ method: m[1].toUpperCase(), path: `${ROUTE_PREFIX}${m[2]}` });
  }
  return out;
}

const key = (r: Route): string => `${r.method} ${normalize(r.path)}`;

describe('MCP 工具声明 · 与后端路由同源', () => {
  const gateway = fs.readFileSync(GATEWAY_SRC, 'utf8');
  const controller = fs.readFileSync(CONTROLLER_SRC, 'utf8');

  /** 网关为 deploy 模块声明的全部后端调用（同步工具 + 任务型工具的 submit/status/cancel） */
  const blocks = {
    DEPLOY_HTTP_TOOLS: extractConstBlock(gateway, 'DEPLOY_HTTP_TOOLS'),
    DEPLOY_JOB_TOOLS: extractConstBlock(gateway, 'DEPLOY_JOB_TOOLS'),
    MOCK_JOB_TOOLS: extractConstBlock(gateway, 'MOCK_JOB_TOOLS'),
  };
  const declared = Object.values(blocks).flatMap(extractPairs);
  const routes = parseControllerRoutes(controller);

  it('三块声明各自都解析得出内容（守卫本身没失效）', () => {
    // 正则一旦因为源码风格变化匹配不到，下面所有比对都会"通过"却什么也没查。
    // 这条是守卫的守卫：宁可红，不要假绿。**逐块**断言，抠空一块也要当场暴露
    // （失败时列出的就是解析为空的块名）。
    const emptyBlocks = Object.entries(blocks)
      .filter(([, block]) => extractPairs(block).length === 0)
      .map(([name]) => name);
    expect(emptyBlocks).toEqual([]);
    expect(declared.length).toBeGreaterThan(8);
    expect(routes.length).toBeGreaterThan(8);
  });

  it('后端每个 MCP 路由都被网关声明 —— 漏了则 Agent 够不着，功能等于不存在', () => {
    const declaredKeys = new Set(declared.map(key));
    const missing = routes.filter((r) => !declaredKeys.has(key(r)));
    // 失败时列出的就是"存在但 Agent 看不见"的接口
    expect(missing.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('网关声明的每个调用都在后端存在 —— 多了则 Agent 一调就 404', () => {
    const routeKeys = new Set(routes.map(key));
    const ghost = declared.filter((r) => !routeKeys.has(key(r)));
    // 失败时列出的就是"声明了却不存在"的幽灵接口
    expect(ghost.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('审批通道必须保持通达（approve / reject）', () => {
    // 单独点名：这两条是「自动化发布最后一公里」，掉了就是流水线挂起后无人能放行，
    // 只能回控制台手工点，自动化链路直接断死。历史上就掉过一次（网关从未声明）。
    const keys = new Set(declared.map(key));
    expect(keys).toContain('POST api/mcp/pipeline/*/approve');
    expect(keys).toContain('POST api/mcp/pipeline/*/reject');
  });

  it('工具名在 deploy 模块内唯一', () => {
    const block = [
      extractConstBlock(gateway, 'DEPLOY_HTTP_TOOLS'),
      extractConstBlock(gateway, 'DEPLOY_JOB_TOOLS'),
      extractConstBlock(gateway, 'MOCK_JOB_TOOLS'),
    ].join('\n');
    const names = [...block.matchAll(/^\s{4}name:\s*'([^']+)',/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    // 重名工具会让后注册的覆盖先注册的
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup).toEqual([]);
  });

  it('模块回滚声明必须要求 component，不能把整站恢复藏在可选参数后', () => {
    const block = blocks.DEPLOY_HTTP_TOOLS;
    const start = block.indexOf("name: 'rollback'");
    const end = block.indexOf('\n  {', start);
    const rollback = block.slice(start, end < 0 ? undefined : end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(rollback).toMatch(/name:\s*'component',\s*type:\s*'string',\s*required:\s*true/);
  });
});
