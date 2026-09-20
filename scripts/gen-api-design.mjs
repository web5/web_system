/**
 * 从后端 controller 的 Swagger 注解自动提取接口契约，生成 specs/<svc>/api-design.md。
 *
 * 设计目标：让工程 AI 自进化时有一份「可复现、永不过期」的接口真相源。
 * 运行：node scripts/gen-api-design.mjs （仓库根目录执行）
 *
 * 提取内容：@Controller 基路径、@ApiTags、HTTP 方法（Get/Post/.../All）、
 *           @ApiOperation summary、鉴权装饰器（@Public/@ApiBearerAuth/@UseGuards）、
 *           入参（@Param/@Query/@Body/@Headers，已过滤 @Req/@Res 框架对象），
 *           以及 **请求/查询对象的字段级 schema**（解析 *.dto.ts 的 class-validator/@ApiProperty，
 *           含最多 2 层嵌套 DTO 展开）。
 *
 * 路径口径：统一按「controller 注册路径」呈现，并在各服务头部注明其经 gateway 暴露的
 *           外部前缀（见 GATEWAY_PREFIXES）。gateway 自身的 ProxyController 标了
 *           @ApiExcludeController，是反向代理 catch-all，不计入离散端点，改列路由映射表。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SERVERS_DIR = path.join(ROOT, 'servers');
const SPECS_DIR = path.join(ROOT, 'specs');

const PORTS = {
  gateway: 6000,
  'auth-service': 6101,
  'user-service': 6002,
  'ai-service': 6003,
  'ai-agent': 6010,
  'system-service': 6004,
  'todo-service': 6005,
  'mcp-gateway': 6006,
  'content-hub': 6007,
  'upload-service': 6008,
  'knowledge-service': 6011,
  'deploy-console': 6200,
};

/** 各服务经 gateway 暴露的外部前缀（来源：gateway/src/proxy/proxy.controller.ts） */
const GATEWAY_PREFIXES = {
  'auth-service': '/api/auth, /api/auth/qrcode',
  'user-service': '/api/users, /api/keys, /api/permissions/my, /api/admin/permissions, /api/admin/roles, /api/uploads(静态)',
  'ai-service': '/api/ai, /api/agent-defs, /api/agent-runs, /api/admin/skills, /api/bianbian',
  'ai-agent': '/api/ai-agent',
  'system-service': '/api/admin(除 permissions/roles/skills), /api/dict',
  'knowledge-service': '/api/knowledge',
  'todo-service': '/api/todos',
  'upload-service': '/api/upload',
  'mcp-gateway': '/api/mcp',
  'content-hub': '/api/content-hub',
  gateway: '(自身即网关)',
};

/** gateway 路由映射表（来源同 proxy.controller.ts，确定性真相） */
const GATEWAY_ROUTES = [
  ['/api/auth', 'auth-service'],
  ['/api/users, /api/keys', 'user-service'],
  ['/api/permissions/my, /api/admin/permissions, /api/admin/roles', 'user-service'],
  ['/api/ai, /api/ai/chat/stream(SSE), /api/ai/tts/speak', 'ai-service'],
  ['/api/ai-agent, /api/ai-agent/agent/run(SSE), /api/ai-agent/agent/admin-run(SSE)', 'ai-agent'],
  ['/api/admin/skills', 'ai-service'],
  ['/api/admin(其余), /api/dict', 'system-service'],
  ['/api/agent-runs', 'ai-service'],
  ['/api/knowledge', 'knowledge-service'],
  ['/api/agent-defs', 'ai-service'],
  ['/api/bianbian', 'ai-service'],
  ['/api/todos', 'todo-service'],
  ['/api/upload', 'upload-service'],
  ['/api/uploads', 'user-service(静态)'],
  ['/api/uploads/bianbian', 'ai-service(静态)'],
  ['/api/mcp', 'mcp-gateway'],
  ['/api/content-hub', 'content-hub'],
];

const HTTP_METHODS = ['Get', 'Post', 'Put', 'Delete', 'Patch', 'Sse', 'All', 'Options', 'Head'];
const METHOD_MAP = {
  Get: 'GET', Post: 'POST', Put: 'PUT', Delete: 'DELETE',
  Patch: 'PATCH', Sse: 'SSE', All: 'ALL', Options: 'OPTIONS', Head: 'HEAD',
};

function listControllers(svcDir) {
  const srcDir = path.join(svcDir, 'src');
  if (!fs.existsSync(srcDir)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.controller.ts')) out.push(full);
    }
  };
  walk(srcDir);
  return out;
}

function strArg(decLine) {
  const m = decLine.match(/\(\s*(['"`])(.*?)\1\s*\)/);
  return m ? m[2] : '';
}

function buildPath(base, route) {
  const b = (base || '').replace(/^\/+/, '');
  const r = (route || '').replace(/^\/+/, '');
  const pre = b.toLowerCase().startsWith('api') ? '' : '/api';
  const p = `${pre}/${b}/${r}`.replace(/\/+/g, '/');
  return p || '/';
}

function balancedSig(s) {
  // 方法签名是否已达终点：出现 `) {` / `) :` / `) =>` 等
  return /\)\s*[\{:=>]/.test(s);
}

/** 解析某服务下所有 *.dto.ts，得到 className -> { fields: [{name,type,optional,description,required}] } */
function parseDtos(svcDir) {
  const src = path.join(svcDir, 'src');
  if (!fs.existsSync(src)) return {};
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.dto.ts')) files.push(full);
    }
  };
  walk(src);
  const dtos = {};
  const SKIP = new Set(['if', 'for', 'while', 'const', 'let', 'return', 'throw', 'switch',
    'export', 'import', 'else', 'case', 'default', 'do', 'try', 'catch', 'finally', 'new',
    'await', 'async', 'yield', 'typeof', 'this', 'function']);
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    let cls = null, api = null;
    for (const raw of lines) {
      const line = raw.trim();
      const cm = line.match(/export\s+class\s+(\w+)/);
      if (cm) { cls = { name: cm[1], fields: [] }; dtos[cls.name] = cls; api = null; continue; }
      if (/@ApiProperty\b/.test(line)) {
        const desc = (line.match(/description\s*:\s*(['"`])(.*?)\1/) || [])[2] || '';
        const req = (line.match(/required\s*:\s*(false|true)/) || [])[1];
        api = { description: desc, required: req === 'true' ? true : req === 'false' ? false : undefined };
        continue;
      }
      const pm = line.match(/^([A-Za-z_$][\w$]*)(\?|!)?\s*:\s*(.+?)\s*;?\s*$/);
      if (pm && cls && !line.includes('(') && !line.includes('=>') && !SKIP.has(pm[1])) {
        const type = pm[3].split(/=(?!=)/)[0].replace(/\s+/g, ' ').trim(); // 去掉默认值 `= xxx`
        cls.fields.push({ name: pm[1], type, optional: pm[2] === '?', description: api?.description || '', required: api?.required });
        api = null;
      } else if (!/^@/.test(line)) {
        api = null; // 非装饰器/非属性行，避免 description 串味
      }
    }
  }
  return dtos;
}

/** 从方法签名提取 @Param/@Query/@Body/@Headers 参数（兼容带嵌套括号的管道装饰器），含 TS 类型 */
function extractParams(sig) {
  const params = [];
  const kinds = ['Param', 'Query', 'Body', 'Headers'];
  for (const k of kinds) {
    const re = new RegExp(`@${k}\\(`, 'g');
    let m;
    while ((m = re.exec(sig)) !== null) {
      let i = m.index + m[0].length, depth = 1;
      while (i < sig.length && depth > 0) {
        if (sig[i] === '(') depth++;
        else if (sig[i] === ')') { depth--; if (depth === 0) break; }
        i++;
      }
      const decArgs = sig.slice(m.index + m[0].length, i).trim();
      const rest = sig.slice(i + 1);
      const vm = rest.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?(?:<[^>]+>)?(?:\[\])?|\{[^{}]*\})/);
      if (!vm) continue;
      const varName = vm[1];
      const type = vm[2];
      const argName = (decArgs.match(/['"](\w+)['"]/) || [])[1];
      const name = argName || (k === 'Body' && !type.startsWith('{') ? varName : varName);
      params.push({ kind: k, name, type });
    }
  }
  return params;
}

/** 渲染 DTO 字段表（递归最多 2 层，带环保护） */
function renderDto(dtoName, dtos, depth, seen) {
  const dto = dtos[dtoName];
  if (!dto) return `_（未找到 \`${dtoName}\` 的 DTO 定义）_`;
  if (depth > 2 || seen.has(dtoName)) return '';
  seen.add(dtoName);
  let out = `| 字段 | 类型 | 必填 | 说明 |\n|---|---|---|---|\n`;
  for (const f of dto.fields) {
    const req = f.optional || f.required === false ? '否' : f.required === true ? '是' : '是(默认)';
    out += `| ${f.name} | ${f.type} | ${req} | ${f.description} |\n`;
  }
  let nested = '';
  for (const f of dto.fields) {
    const tn = f.type.replace(/<.*>|\[.*\]/g, '').trim();
    if (dtos[tn] && !seen.has(tn)) {
      nested += `\n###### ${dtoName}.${f.name} → \`${tn}\`\n\n` + renderDto(tn, dtos, depth + 1, seen) + '\n';
    }
  }
  return out + nested;
}

function parseController(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const classes = [];
  let classCtx = null;
  let pending = null; // { decorators: [], sig: '' }
  let excludeNext = false;

  const flushMethod = (p) => {
    if (!classCtx) { pending = null; return; }
    const sig = p.sig;
    const m = sig.match(/(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
    if (!m) { pending = null; return; }
    const name = m[1];
    const decorators = p.decorators;
    let method = null, route = '';
    for (const d of decorators) {
      for (const h of HTTP_METHODS) {
        if (new RegExp(`@${h}\\b`).test(d)) { method = METHOD_MAP[h]; route = strArg(d); break; }
      }
      if (method) break;
    }
    if (!method) { pending = null; return; }
    const summaryMatch = decorators.find((d) => /@ApiOperation/.test(d));
    let summary = '';
    if (summaryMatch) summary = (summaryMatch.match(/summary\s*:\s*(['"`])(.*?)\1/) || [])[2] || '';
    const auth = decorators.find((d) => /@Public/.test(d)) ? 'public'
      : decorators.find((d) => /@ApiBearerAuth/.test(d)) ? 'bearer'
      : (classCtx.auth || '');
    const guardMatch = decorators.find((d) => /@UseGuards/.test(d));
    const guard = guardMatch ? strArg(guardMatch) || 'custom' : '';
    // 入参：从完整签名提取，仅保留 API 语义参数，过滤 @Req/@Res 框架对象；同时捕获 TS 类型（用于解析 DTO 字段）
    const params = extractParams(sig);
    classCtx.methods.push({ method, route, summary, auth, guard, params });
    pending = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (/@ApiExcludeController/.test(line)) { excludeNext = true; continue; }
    if (/@Controller\s*\(/.test(line)) {
      let base = strArg(line);
      if (!base) {
        const obj = line.match(/path\s*:\s*['"`](.*?)['"`]/);
        base = obj ? obj[1] : '';
      }
      classCtx = { base, name: '', tags: '', auth: '', methods: [], excluded: excludeNext };
      excludeNext = false;
      continue;
    }
    if (classCtx && /@ApiTags\s*\(/.test(line)) { classCtx.tags = strArg(line); continue; }
    if (classCtx && /@ApiBearerAuth/.test(line)) { classCtx.auth = 'bearer'; continue; }
    if (/export\s+class/.test(line) && classCtx) {
      if (classCtx.excluded) { classCtx = null; continue; }
      const cm = line.match(/export\s+class\s+(\w+)/);
      if (cm) classCtx.name = cm[1];
      classes.push(classCtx);
      continue;
    }
    // 方法解析状态机：遇到 HTTP 装饰器 → 收集装饰器 → 累积签名（支持多行）→ 平衡后落库
    if (classCtx && !pending && HTTP_METHODS.some((h) => new RegExp(`^@${h}\\b`).test(line))) {
      pending = { decorators: [line], sig: '' };
      continue;
    }
    if (pending) {
      if (!pending.sig) {
        if (/^@\w+/.test(line)) { pending.decorators.push(line); continue; }
        if (/(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(line)) {
          pending.sig = line;
          if (balancedSig(pending.sig)) flushMethod(pending);
          continue;
        }
        continue; // 装饰器与方法之间的注释等，忽略
      } else {
        pending.sig += ' ' + line;
        if (balancedSig(pending.sig)) flushMethod(pending);
        continue;
      }
    }
  }
  return classes;
}

function endpointBlock(m, base, dtos) {
  const full = buildPath(base, m.route);
  let out = `### ${m.method} ${full}\n`;
  if (m.summary) out += `- 说明：${m.summary}\n`;
  const auth = m.auth === 'public' ? '公开（@Public）'
    : m.auth === 'bearer' ? 'Bearer JWT'
    : m.auth === 'custom' ? `自定义守卫（${m.guard || 'UseGuards'}）`
    : '未显式标注（按服务鉴权策略）';
  out += `- 鉴权：${auth}\n`;
  if (m.params.length) {
    const ps = m.params.map((p) => {
      let s = `${p.kind}:${p.name}`;
      if (p.type && dtos[p.type]) s += `(${p.type})`;
      return s;
    }).join('、');
    out += `- 入参：${ps}\n`;
    const dtoParams = m.params.filter((p) => dtos[p.type]);
    if (dtoParams.length) {
      out += '\n**字段定义**\n';
      for (const p of dtoParams) {
        out += `\n##### ${p.kind} 对象 \`${p.type}\`\n\n` + renderDto(p.type, dtos, 0, new Set()) + '\n';
      }
    }
  }
  return out + '\n';
}

function renderService(svc, classes, dtos) {
  const port = PORTS[svc] || '?';
  const gw = GATEWAY_PREFIXES[svc] || '';
  const header = `# ${svc} · 接口契约（api-design）

> 服务：\`servers/${svc}\`（端口 ${port}）
> 本文档由 \`scripts/gen-api-design.mjs\` 从 Swagger 注解自动提取，作为工程 AI 自进化的接口真相源；字段级 schema 以运行时 Swagger（非 production 环境各服务 \`/api/docs\`）为准。
> 路径口径：下表为 **controller 注册路径**；经 gateway 对外访问时，需在路径前加对应**外部前缀**（见下）。

## 网关访问前缀

本服务经 gateway 暴露的外部前缀：${gw}

> 例：若外部前缀为 \`/api/auth\`、某接口注册路径为 \`/auth/login\`，则外部可调用路径为 \`/api/auth/login\`；若注册路径首段已含外部前缀（如 \`/ai/agent\`），则直接拼接为 \`/api/ai/agent\`。具体映射以 gateway 的 ProxyController 路由为准。

## 通用约定

- 鉴权标注：\`public\` = 标记 \`@Public()\`（免 JWT，但可能需服务间 Bearer Key）；\`bearer\` = 需 \`Authorization: Bearer\`；\`custom\` = 走指定 \`@UseGuards\`；空白 = 未显式标注，按服务鉴权策略。
- 入参标注：\`Param\` = 路径参数；\`Query\` = 查询参数；\`Body\` = 请求体；\`Headers\` = 请求头。（已过滤 \`@Req/@Res\` 框架对象）
`;
  let body = '';
  for (const c of classes) {
    const base = c.base || '';
    const tag = c.tags || c.name;
    body += `\n## ${tag}（\`${c.name}\` → 注册路径基 \`${base || '/'}\`）\n\n`;
    if (!c.methods.length) { body += '_无 HTTP 端点（纯内部/抽象类）_\n'; continue; }
    for (const m of c.methods) body += endpointBlock(m, base, dtos);
  }
  return header + body;
}

function renderGateway(classes, dtos) {
  const header = `# gateway · 接口契约（api-design）

> 服务：\`servers/gateway\`（端口 6000）
> 网关 = API 反代 + 微前端基座 + 版本分发/灰度。以下分两部分：① 网关自有 controller（api-docs/version/health/mini-scan/swagger-docs）；② **路由映射表**（ProxyController 是反向代理 catch-all，标了 @ApiExcludeController，不列为离散端点，其转发规则见下表）。

## 通用约定

- 所有 \`/api/*\` 请求经 gateway 反代到各后端微服务；gateway 自身不实现业务逻辑，仅转发。
- 鉴权由**下游微服务**各自处理（ProxyController 标 \`@Public()\`），gateway 只做转发与超时控制。
`;
  let body = '';
  for (const c of classes) {
    const base = c.base || '';
    const tag = c.tags || c.name;
    body += `\n## ${tag}（\`${c.name}\` → 注册路径基 \`${base || '/'}\`）\n\n`;
    if (!c.methods.length) { body += '_无 HTTP 端点_\n'; continue; }
    for (const m of c.methods) body += endpointBlock(m, base, dtos);
  }
  body += `## 路由映射表（ProxyController → 下游服务）

> 来源：\`servers/gateway/src/proxy/proxy.controller.ts\`。外部路径前缀 → 转发目标。其余未匹配 \`/api/*\` 返回 404。

| 外部前缀 | 转发到 |
|---|---|
`;
  for (const [p, t] of GATEWAY_ROUTES) body += `| \`${p}\` | ${t} |\n`;
  return header + body;
}

function main() {
  if (!fs.existsSync(SPECS_DIR)) fs.mkdirSync(SPECS_DIR, { recursive: true });
  const services = fs.readdirSync(SERVERS_DIR).filter((s) =>
    fs.existsSync(path.join(SERVERS_DIR, s, 'src')));
  let total = 0;
  for (const svc of services) {
    if (svc === 'deploy-console') continue; // 已由手写文档覆盖
    const controllers = listControllers(path.join(SERVERS_DIR, svc));
    if (!controllers.length) continue;
    const allClasses = [];
    for (const f of controllers) allClasses.push(...parseController(f));
    if (!allClasses.length) continue;
    const dtos = parseDtos(path.join(SERVERS_DIR, svc));
    const md = svc === 'gateway' ? renderGateway(allClasses, dtos) : renderService(svc, allClasses, dtos);
    const outDir = path.join(SPECS_DIR, svc);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'api-design.md'), md);
    const ep = allClasses.reduce((n, c) => n + c.methods.length, 0);
    total += ep;
    process.stdout.write(`✓ ${svc}: ${allClasses.length} controllers, ${ep} endpoints -> specs/${svc}/api-design.md\n`);
  }
  process.stdout.write(`\n完成：共 ${total} 个端点（不含 gateway 代理 catch-all）。\n`);
}

main();
