/// <reference types="node" />
/**
 * 包体闸门守护：packOptions.ignore 必须覆盖小程序包根的密钥文件
 *
 * ── 为什么需要这条守护 ────────────────────────────────────────────────
 * 微信小程序有**两套互不相干**的闸门，别把它们当成一套：
 *   · .gitignore                     → 决定什么进 **git 仓库**（防泄漏到 GitHub）
 *   · project.config.json 的
 *     packOptions.ignore             → 决定什么进 **上传包体**（防泄漏到用户端）
 * 已被上游代码证实：
 *   ① miniprogram-ci 全量 dist 里 grep 不到 `.gitignore` —— 打包引擎不读它；
 *   ② CIProject 构造时 `this.packOptions = t.packOptions || {ignore:[],include:[]}`，
 *      未显式传 packOptions 时回落到 project.config.json（两个 app 的 scripts/upload.js
 *      都只传 `ignores: ['node_modules 通配']`，没传 packOptions → 走 config 文件）；
 *   ③ 编译期由 packOptionsHelper.isIgnoredByRules() 判定 EFilterCode.PackOptionsIgnore。
 * 因此「private.key 已在 .gitignore 里」并不能说明它不进包。私钥一旦进包，包体可被
 * 下载 + 解包提取，等于把上传密钥交给全量用户。
 *
 * ── 为什么放在 apps/dachengzi-minigram/tests/（而不是仓库级 tests/）──────────
 * ① 仓库级 tests/ 只有 Playwright（tests/playwright.config.ts），根 package.json 没有
 *    jest 项目；要在仓库级跑 jest 就得引新依赖/新 runner —— 与本改动的范围不成比例。
 * ② 两个 app 都已有 ts-jest 套件（apps/*-minigram/{package.json}.test = jest tests），
 *    把守护放进现有 jest 项目 = 零新增依赖、`pnpm test` 里天然被跑到。
 * ③ 选 dachengzi 而非 kedou：dachengzi 是当前在发版链上的包（1.0.18-r2），发版前后
 *    必跑它的 test；且守的是**跨两个 app** 的规则，放哪个 app 下都能覆盖（路径用
 *    `apps/` 计算，与 cwd 无关）。
 * ④ `tests` 目录本身在两个 app 的 packOptions.ignore 里，本文件不会被自己打包进去。
 *
 * ── 守护强度（不是只盯 private.key 一个文件名）──────────────────────
 * · 规则存在性：两个包都必须声明 private.key 规则；
 * · 覆盖完整性：扫**包根所有密钥文件**（扩展名见 SECRET_EXTENSIONS：`.key` / `.pem`，
 *   含 `upload.key`、`apiclient.key`、`cert.pem`… 任意名字），逐个用与引擎等价的
 *   匹配器判定必须被 ignore 覆盖 —— 将来谁在包根多放一把密钥，这里立刻变红，
 *   逼人显式决定；
 * · 不误报：`.example` 模板（`private.key.example`）不是密钥，**不进**扫描集，
 *   避免被"名字里带 key"的模板文件刷成假红；
 * · include 抵消：packOptions 的 isIgnoredByRules = !isFileIncluded && isFileIgnored，
 *   被 include 命中的文件即使躺在 ignore 里也会进包，所以一并守住；
 * · 存量规则不回退：本次改动只允许追加，不允许把既有条目删掉/替换。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface IgnoreRule {
  type: string;
  value: string;
}

interface ProjectConfig {
  packOptions?: {
    ignore?: IgnoreRule[];
    include?: IgnoreRule[];
  };
  [k: string]: unknown;
}

/** 本用例目录：apps/dachengzi-minigram/tests */
const TESTS_DIR = __dirname;
/** 当前 app 包根：apps/dachengzi-minigram */
const THIS_APP_ROOT = path.resolve(TESTS_DIR, '..');
/** apps/ */
const APPS_DIR = path.resolve(THIS_APP_ROOT, '..');

/** 必须被守住的 minigram 包（顺序即修复单里的两个 app） */
const REQUIRED_APPS = ['dachengzi-minigram', 'kedou-ai-minigram'];

/** 本次补的规则字面量（守护它没被改名/改 type） */
const PRIVATE_KEY_RULE: IgnoreRule = { type: 'file', value: 'private.key' };

/**
 * 密钥文件的扩展名集合 —— 按**真实后缀**判定，不用 `名字里带 key/private` 的宽正则。
 * 反面教材：`project.private.config.json` 是微信开发者工具的本地私有配置（本来就该
 * 在 ignore 里），用 /key|private/i 扫会把它当成"私钥规则"造出假阳性；
 * `private.key.example` 是模板、不含密钥，也不该进扫描集。
 */
const SECRET_EXTENSIONS = ['.key', '.pem'];

/**
 * 本次改动前的存量 ignore 条目快照（逐个抄自 origin/master 998910c5 的
 * project.config.json）。守护「只追加不删减」：存量必须仍是子集，哪怕以后合法新增。
 */
const BASELINE_IGNORE: Record<string, IgnoreRule[]> = {
  'kedou-ai-minigram': [
    { type: 'folder', value: 'docs' },
    { type: 'folder', value: 'prototype' },
    { type: 'folder', value: 'tests' },
    { type: 'folder', value: 'scripts' },
    { type: 'folder', value: 'typings' },
    { type: 'folder', value: 'node_modules' },
    { type: 'file', value: 'tsconfig.json' },
    { type: 'file', value: 'package.json' },
    { type: 'file', value: 'package-lock.json' },
    { type: 'file', value: 'jest.config.js' },
    { type: 'file', value: 'project.private.config.json' },
  ],
  'dachengzi-minigram': [
    { type: 'folder', value: 'docs' },
    { type: 'folder', value: 'prototype' },
    { type: 'folder', value: 'tests' },
    { type: 'folder', value: 'scripts' },
    { type: 'folder', value: 'typings' },
    { type: 'folder', value: 'node_modules' },
    { type: 'folder', value: '.ci-output' },
    { type: 'file', value: 'tsconfig.json' },
    { type: 'file', value: 'package.json' },
    { type: 'file', value: 'package-lock.json' },
    { type: 'file', value: 'jest.config.js' },
    { type: 'file', value: 'project.private.config.json' },
  ],
};

// ---------------------------------------------------------------------------
// 与打包引擎等价的匹配器
//
// 逐条移植自 miniprogram-ci 的 dist/utils/filerules.js：doRule() 的六种 type
// （prefix / suffix / folder / file / glob / regexp）+ 外层工厂把「路径」也转小写，
// 所以匹配是大小写不敏感的。移植而非 import 引擎内部文件，是为了不让守护用例
// 依赖 miniprogram-ci 的私有路径与安装状态。
// ---------------------------------------------------------------------------
function leading(p: string, c: string): string {
  return p.startsWith(c) ? p : c + p;
}

function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** @param relPath 相对包根的 posix 路径（如 "private.key"、"sub/a.key"） */
function matchesRule(relPath: string, rule: IgnoreRule): boolean {
  if (!rule || typeof rule.value !== 'string' || !rule.value) return false;
  const p = relPath.replace(/\\/g, '/').toLowerCase();
  const value = rule.value.toLowerCase();
  const basename = p.slice(p.lastIndexOf('/') + 1);

  switch (rule.type) {
    case 'prefix':
      return basename.startsWith(value);
    case 'suffix':
      return basename.endsWith(value);
    case 'folder':
      return leading(p, '/').startsWith(leading(value, '/').endsWith('/') ? leading(value, '/') : `${leading(value, '/')}/`);
    case 'file':
      return leading(p, '/') === leading(value, '/');
    case 'glob':
      return globToRegExp(value).test(p) || globToRegExp(value).test(leading(p, '/'));
    case 'regexp':
      try {
        return new RegExp(value, 'igm').test(p) || new RegExp(value, 'igm').test(leading(p, '/'));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function matchesAny(relPath: string, rules: IgnoreRule[]): boolean {
  return rules.some((rule) => matchesRule(relPath, rule));
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

interface AppAudit {
  app: string;
  appDir: string;
  configPath: string;
  ignoreRules: IgnoreRule[];
  includeRules: IgnoreRule[];
  /** 包根实际存在的密钥文件名（扩展名见 SECRET_EXTENSIONS；无则空数组） */
  secretFiles: string[];
  /** 没被任何 ignore 规则覆盖的密钥文件 */
  uncovered: string[];
  /** 被 include 规则命中（会抵消 ignore）的密钥文件 */
  includeOverridden: string[];
  hasPrivateKeyRule: boolean;
}

function readProjectConfig(configPath: string): ProjectConfig {
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as ProjectConfig;
}

/** 包根（非递归）的密钥文件：扩展名命中 SECRET_EXTENSIONS */
function listRootSecretFiles(appDir: string): string[] {
  return fs
    .readdirSync(appDir, { withFileTypes: true })
    .filter(
      (d) => d.isFile() && SECRET_EXTENSIONS.some((ext) => d.name.toLowerCase().endsWith(ext)),
    )
    .map((d) => d.name)
    .sort();
}

/** 对一个包根做审计；appDir 由调用方给，负例可指向临时目录 */
function auditAppDir(appName: string, appDir: string): AppAudit {
  const configPath = path.join(appDir, 'project.config.json');
  const config = readProjectConfig(configPath);
  const ignoreRules = config.packOptions?.ignore ?? [];
  const includeRules = config.packOptions?.include ?? [];
  const secretFiles = listRootSecretFiles(appDir);

  return {
    app: appName,
    appDir,
    configPath,
    ignoreRules,
    includeRules,
    secretFiles,
    uncovered: secretFiles.filter((f) => !matchesAny(f, ignoreRules)),
    includeOverridden: secretFiles.filter((f) => matchesAny(f, includeRules)),
    hasPrivateKeyRule: ignoreRules.some(
      (r) => r.type === PRIVATE_KEY_RULE.type && String(r.value).toLowerCase() === PRIVATE_KEY_RULE.value,
    ),
  };
}

function auditApp(appName: string): AppAudit {
  return auditAppDir(appName, path.join(APPS_DIR, appName));
}

/** 自动发现 apps/ 下所有 *-minigram 包（新增 minigram app 也会被要求过同一道闸门） */
function listMinigramApps(): string[] {
  return fs
    .readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.endsWith('-minigram'))
    .map((d) => d.name)
    .sort();
}

/** 临时造一个最小包根：写 project.config.json + 造指定文件名 */
function makeFixtureDir(opts: {
  ignore: IgnoreRule[];
  include?: IgnoreRule[];
  secretFiles: string[];
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-ignore-'));
  fs.writeFileSync(
    path.join(dir, 'project.config.json'),
    JSON.stringify(
      { packOptions: { ignore: opts.ignore, include: opts.include ?? [] } },
      null,
      2,
    ),
  );
  opts.secretFiles.forEach((f) => fs.writeFileSync(path.join(dir, f), 'fake-key-bytes'));
  return dir;
}

// ---------------------------------------------------------------------------
// 正向守护：真仓库的两个包
// ---------------------------------------------------------------------------
describe('packOptions.ignore 覆盖包根密钥（微信包体闸门）', () => {
  it('apps/ 下能发现两个 minigram 包，且本用例路径推导正确', () => {
    expect(fs.existsSync(path.join(THIS_APP_ROOT, 'project.config.json'))).toBe(true);
    expect(listMinigramApps()).toEqual(expect.arrayContaining([...REQUIRED_APPS]));
  });

  it.each(REQUIRED_APPS)('%s：project.config.json 合法且 packOptions.ignore 是数组', (app) => {
    const audit = auditApp(app);
    expect(fs.existsSync(audit.configPath)).toBe(true);
    expect(Array.isArray(audit.ignoreRules)).toBe(true);
    expect(audit.ignoreRules.length).toBeGreaterThan(0);
  });

  it.each(REQUIRED_APPS)('%s：ignore 含 { type: "file", value: "private.key" }', (app) => {
    const audit = auditApp(app);
    expect(audit.hasPrivateKeyRule).toBe(true);
  });

  it.each(REQUIRED_APPS)('%s：包根所有密钥文件（*.key / *.pem）都被 ignore 覆盖，且未被 include 抵消', (app) => {
    const audit = auditApp(app);
    // audit.secretFiles 是包根实测到的密钥文件清单；失败时它随断言差异一起打印出来
    expect({ uncovered: audit.uncovered, includeOverridden: audit.includeOverridden }).toEqual({
      uncovered: [],
      includeOverridden: [],
    });
  });

  it('apps/ 下所有 *-minigram 包（含将来新增）包根密钥文件均被覆盖', () => {
    const violations = listMinigramApps().map((app) => {
      const audit = auditApp(app);
      return { app, uncovered: audit.uncovered, includeOverridden: audit.includeOverridden };
    });
    expect(violations.filter((v) => v.uncovered.length || v.includeOverridden.length)).toEqual([]);
  });

  it.each(REQUIRED_APPS)('%s：存量 ignore 条目未被删减（本次只允许追加）', (app) => {
    const audit = auditApp(app);
    const missing = BASELINE_IGNORE[app].filter(
      (base) => !audit.ignoreRules.some((r) => r.type === base.type && r.value === base.value),
    );
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 负例矩阵：证明上面那几条断言真的会红（不是恒真）
// ---------------------------------------------------------------------------
describe('负例：闸门缺失时必须报出违规', () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop();
      if (d) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function fixture(opts: Parameters<typeof makeFixtureDir>[0]): string {
    const d = makeFixtureDir(opts);
    dirs.push(d);
    return d;
  }

  it('规则缺失（ignore 为空）→ hasPrivateKeyRule=false 且 private.key 落在 uncovered', () => {
    const dir = fixture({ ignore: [], secretFiles: ['private.key'] });
    const audit = auditAppDir('fixture', dir);
    expect(audit.hasPrivateKeyRule).toBe(false);
    expect(audit.uncovered).toEqual(['private.key']);
  });

  it('规则只写 private.key → 换一个名字的 key（apiclient.key）仍必须变红（不是只盯一个文件名）', () => {
    const dir = fixture({
      ignore: [PRIVATE_KEY_RULE],
      secretFiles: ['private.key', 'apiclient.key', 'upload.key'],
    });
    const audit = auditAppDir('fixture', dir);
    expect(audit.hasPrivateKeyRule).toBe(true);
    expect(audit.uncovered).toEqual(['apiclient.key', 'upload.key']);
  });

  it('🔴 *.pem 也在射程内：规则只写 private.key 时，cert.pem / server.pem 必须变红', () => {
    const dir = fixture({
      ignore: [PRIVATE_KEY_RULE],
      secretFiles: ['private.key', 'cert.pem', 'server.pem'],
    });
    const audit = auditAppDir('fixture', dir);
    expect(audit.secretFiles).toEqual(['cert.pem', 'private.key', 'server.pem']);
    expect(audit.uncovered).toEqual(['cert.pem', 'server.pem']);
  });

  it('不误报：.example 模板（private.key.example / cert.pem.example）不是密钥，不进扫描集', () => {
    const dir = fixture({
      ignore: [PRIVATE_KEY_RULE],
      secretFiles: ['private.key.example', 'cert.pem.example', 'private.key'],
    });
    const audit = auditAppDir('fixture', dir);
    // 只有真实密钥文件被扫到；两个 .example 模板不参与判定 → 不制造假红
    expect(audit.secretFiles).toEqual(['private.key']);
    expect(audit.uncovered).toEqual([]);
  });

  it('不误报：project.private.config.json（名字带 private）不是密钥文件', () => {
    const dir = fixture({
      ignore: [PRIVATE_KEY_RULE],
      secretFiles: ['project.private.config.json'],
    });
    const audit = auditAppDir('fixture', dir);
    expect(audit.secretFiles).toEqual([]);
    expect(audit.uncovered).toEqual([]);
    // 反过来：用宽正则 /key|private/i 会把它当成"已有 key 规则"，这正是要避免的假阳性
    expect(/key|private/i.test('project.private.config.json')).toBe(true);
    expect(SECRET_EXTENSIONS.some((ext) => 'project.private.config.json'.endsWith(ext))).toBe(false);
  });

  it('ignore 命中但 include 也命中 → 计入 includeOverridden（引擎里 include 会抵消 ignore）', () => {
    const dir = fixture({
      ignore: [PRIVATE_KEY_RULE],
      include: [PRIVATE_KEY_RULE],
      secretFiles: ['private.key'],
    });
    const audit = auditAppDir('fixture', dir);
    expect(audit.uncovered).toEqual([]);
    expect(audit.includeOverridden).toEqual(['private.key']);
  });

  it('忽略粒度：type=file 只吃包根同名文件，不吃子目录同名文件', () => {
    expect(matchesRule('private.key', PRIVATE_KEY_RULE)).toBe(true);
    expect(matchesRule('sub/private.key', PRIVATE_KEY_RULE)).toBe(false);
  });

  it('忽略粒度：type=suffix / glob 这类通配写法也能被正确判定（可用作收紧手段）', () => {
    expect(matchesRule('sub/apiclient.key', { type: 'suffix', value: '.key' })).toBe(true);
    expect(matchesRule('apiclient.key', { type: 'glob', value: '*.key' })).toBe(true);
    expect(matchesRule('sub/apiclient.key', { type: 'glob', value: '*.key' })).toBe(false);
  });

  it('大小写不敏感（引擎把路径与 value 都转小写）', () => {
    expect(matchesRule('PRIVATE.KEY', PRIVATE_KEY_RULE)).toBe(true);
  });
});
