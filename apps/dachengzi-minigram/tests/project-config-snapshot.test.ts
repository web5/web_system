/// <reference types="node" />
/**
 * H5 · `project.config.json` 快照守卫（台账 9143）
 *
 * 为什么需要：真机 E2E（`mp-e2e` → 微信开发者工具）会**回写** `project.config.json`
 * —— 已知会往 `setting` 里塞 `isGameTourist` 并整体重排版。而 `project.config.json` 的
 * `packOptions` 决定「哪些文件进包」，它被悄悄改掉，**下次出码的包内容就和人以为的不一样**，
 * 在 `git status` 里却只表现为一次无关的格式变更，人看不见。
 *
 * 分工（逻辑在 `tests/setup.js`，本文件只负责「让它在 jest 里真的跑起来」）：
 *   - `beforeAll` 取快照（内存，两个 app 根：dachengzi + 同仓 kedou）；
 *   - `afterAll` 比对：变了 → **先还原原内容**，再抛错让本套件**红**（不是打印警告）；
 *   - 纯函数用例用临时目录造病态样本（新增 key / 改值 / 造文件 / 坏 JSON），不碰真文件。
 *
 * 🔴 反证记录（2026-11-26，rd-engineer-h5docs-2 实测）：
 *    只靠「beforeAll 内存快照」这一层是**假守卫** —— 手工把 `project.config.json` 改脏
 *    （插 `setting.isGameTourist` + 重排版）**再**跑本套件，结果 **PASS**：快照拍到的
 *    已经是脏内容，等于自己跟自己比。真实事故形态恰恰如此（回写发生在上一轮 E2E、另一个进程）。
 *    因此加了第二层「提交基线」判据 `diffAgainstCommitted()`：磁盘 vs `git show HEAD:./project.config.json`。
 *    反证（改脏 → 跑 → 红 → 还原 → 绿）见本文件末尾 describe「提交基线层（临时 git 仓库，不碰本仓库）」
 *    与提交信息 / 回执。
 */

const fs = require('fs') as { readFileSync(p: string, enc: string): string; writeFileSync(p: string, s: string): void; mkdtempSync(p: string): string; existsSync(p: string): boolean; rmSync(p: string, o?: { recursive?: boolean; force?: boolean }): void };
const os = require('os') as { tmpdir(): string };
const path = require('path') as { join(...parts: string[]): string; basename(p: string): string };

/** setup.js 是 JS 模块，这里按实际导出面显式声明类型（tsconfig include 只含 .ts，不受 allowJs 推断影响） */
interface ProjectConfigSnapshot {
  file: string;
  exists: boolean;
  raw: string | null;
}

interface KeyDiff {
  key: string;
  before: string;
  after: string;
}

interface ConfigDiff {
  file: string;
  status: 'unchanged' | 'changed' | 'created' | 'deleted';
  keys: KeyDiff[];
  tier: 'run' | 'committed';
  parseNote?: string;
}

interface GuardResult {
  ok: boolean;
  message: string;
  diffs: ConfigDiff[];
}

interface Guard {
  snapshot: ProjectConfigSnapshot[];
  verify(): GuardResult;
}

const setup = require('./setup') as {
  PROJECT_CONFIG_APPS: string[];
  PROJECT_CONFIG_NAME: string;
  snapshotProjectConfigs(appRoots?: string[]): ProjectConfigSnapshot[];
  diffProjectConfigs(snapshot: ProjectConfigSnapshot[]): ConfigDiff[];
  readCommittedProjectConfig(appRoot: string): { file: string; tracked: boolean; raw: string | null };
  diffAgainstCommitted(appRoots?: string[]): ConfigDiff[];
  restoreProjectConfigs(snapshot: ProjectConfigSnapshot[]): string[];
  formatDiffMessage(diffs: ConfigDiff[]): string;
  guardProjectConfigs(appRoots?: string[]): Guard;
};

/** 整套共用一份快照：beforeAll 取，afterAll 比对 + 还原 + 失败 */
let guard: Guard;

beforeAll(() => {
  guard = setup.guardProjectConfigs();
});

afterAll(() => {
  const result = guard.verify();
  if (!result.ok) {
    // 「运行窗口」层的改动已在 verify() 内还原；「提交基线」层**故意不还原**（可能是人有意改的），
    // 这里只负责让套件红，并把 diff 摘要 + 两条出路原样抛出。
    throw new Error(result.message);
  }
});

describe('快照覆盖面', () => {
  it('默认覆盖两个 app 根（dachengzi + kedou）', () => {
    expect(setup.PROJECT_CONFIG_NAME).toBe('project.config.json');
    expect(setup.PROJECT_CONFIG_APPS).toHaveLength(2);
    const names = setup.PROJECT_CONFIG_APPS.map((p: string) => path.basename(p)).sort();
    expect(names).toEqual(['dachengzi-minigram', 'kedou-ai-minigram']);
  });

  it('快照里至少有一份真实存在的 project.config.json（否则这个守卫形同虚设）', () => {
    expect(guard.snapshot.length).toBe(2);
    const present = guard.snapshot.filter((s: ProjectConfigSnapshot) => s.exists);
    expect(present.length).toBeGreaterThan(0);
    for (const s of present) {
      expect(typeof s.raw).toBe('string');
      expect((s.raw as string).length).toBeGreaterThan(0);
      // 不解析成功就说明快照取到的不是配置，守卫会一直在「无法比对」上打转
      expect(() => JSON.parse(s.raw as string)).not.toThrow();
    }
  });

  it('未改动时不报差异（守卫不制造假红）', () => {
    const diffs = setup.diffProjectConfigs(setup.snapshotProjectConfigs());
    expect(diffs.filter((d: ConfigDiff) => d.status !== 'unchanged')).toEqual([]);
  });
});

describe('diff / 还原 边界（临时目录样本，不碰真文件）', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcsnap-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (root: string, obj: unknown): void => {
    fs.writeFileSync(path.join(root, 'project.config.json'), JSON.stringify(obj, null, 2) + '\n');
  };

  it('值被改 → 抓到 changed 且列出 key/原值/新值；还原后字节级回到原样', () => {
    write(dir, { appid: 'wx1', setting: { urlCheck: true } });
    const snap = setup.snapshotProjectConfigs([dir]);
    const original = fs.readFileSync(path.join(dir, 'project.config.json'), 'utf8');

    // 模拟 DevTools 回写：塞 isGameTourist + 重排版
    fs.writeFileSync(path.join(dir, 'project.config.json'), '{\n  "appid": "wx1",\n  "setting": {\n    "urlCheck": true,\n    "isGameTourist": true\n  }\n}\n');

    const diffs = setup.diffProjectConfigs(snap);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('changed');
    // 必须指认到**叶子字段**（setting.isGameTourist），而不是只报「setting 变了」——
    // setting 有几十个字段，顶层摘要会把真正的改动淹掉
    expect(diffs[0].keys.map((k: KeyDiff) => k.key)).toContain('setting.isGameTourist');
    // 消息里必须能看见「哪个 key、新值」，否则人和机器都无从判断
    const msg = setup.formatDiffMessage(diffs);
    expect(msg).toContain('setting.isGameTourist');
    expect(msg).toContain('isGameTourist');
    expect(msg).toContain('true');

    const restored = setup.restoreProjectConfigs(snap);
    expect(restored).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, 'project.config.json'), 'utf8')).toBe(original);
    // 还原之后差异必须消失，否则「还原」是假的
    expect(setup.diffProjectConfigs(snap).filter((d: ConfigDiff) => d.status !== 'unchanged')).toEqual([]);
  });

  it('快照时不存在、之后被 DevTools 造出来 → 报 created 并删掉该文件（不是留个空文件）', () => {
    const snap = setup.snapshotProjectConfigs([dir]);
    expect(snap[0].exists).toBe(false);

    write(dir, { appid: 'wx1' });
    const diffs = setup.diffProjectConfigs(snap);
    expect(diffs[0].status).toBe('created');

    setup.restoreProjectConfigs(snap);
    expect(fs.existsSync(path.join(dir, 'project.config.json'))).toBe(false);
  });

  it('快照时存在、之后被删 → 报 deleted 并写回原内容', () => {
    write(dir, { appid: 'wx1' });
    const original = fs.readFileSync(path.join(dir, 'project.config.json'), 'utf8');
    const snap = setup.snapshotProjectConfigs([dir]);

    fs.rmSync(path.join(dir, 'project.config.json'));
    expect(setup.diffProjectConfigs(snap)[0].status).toBe('deleted');

    setup.restoreProjectConfigs(snap);
    expect(fs.readFileSync(path.join(dir, 'project.config.json'), 'utf8')).toBe(original);
  });

  it('文件内容坏成非法 JSON 也不抛，按差异处理并在消息里说明', () => {
    write(dir, { appid: 'wx1' });
    const snap = setup.snapshotProjectConfigs([dir]);
    fs.writeFileSync(path.join(dir, 'project.config.json'), '{ 坏掉的 JSON');

    const diffs = setup.diffProjectConfigs(snap);
    expect(diffs[0].status).toBe('changed');
    expect(setup.formatDiffMessage(diffs)).toContain('JSON');
  });

  it('guard().verify() 在有差异时先还原再返回 ok=false（不会留垃圾状态）', () => {
    write(dir, { appid: 'wx1' });
    const original = fs.readFileSync(path.join(dir, 'project.config.json'), 'utf8');
    const g = setup.guardProjectConfigs([dir]);
    fs.writeFileSync(path.join(dir, 'project.config.json'), '{ "appid": "wx2" }\n');

    const result = g.verify();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('project.config.json');
    expect(fs.readFileSync(path.join(dir, 'project.config.json'), 'utf8')).toBe(original);
  });
});

/**
 * 第二层判据「提交基线」：磁盘 vs `git show HEAD:./project.config.json`。
 *
 * 造一个真的临时 git 仓库来测 —— 不能拿本仓库当样本：本仓库的 project.config.json
 * 是否干净取决于当时谁在工作，用它写断言会变成「看运气绿」。
 */
describe('提交基线层（临时 git 仓库，不碰本仓库）', () => {
  const cp = require('child_process') as {
    execFileSync(f: string, a: string[], o?: object): string;
  };

  const gitAvailable = (() => {
    try {
      cp.execFileSync('git', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
      return true;
    } catch {
      return false;
    }
  })();

  let dir: string;
  let cfg: string;

  /** 临时仓库里跑 git（身份用 -c 注入，不依赖全局配置） */
  const git = (...args: string[]): string =>
    cp.execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: dir,
      encoding: 'utf8',
    });

  const writeCfg = (obj: unknown): void => {
    fs.writeFileSync(cfg, JSON.stringify(obj, null, 2) + '\n');
  };

  beforeEach(() => {
    if (!gitAvailable) return;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcbase-'));
    cfg = path.join(dir, 'project.config.json');
    git('init', '-q');
    writeCfg({ appid: 'wx1', packOptions: { ignore: [{ type: 'file', value: 'private.key' }] }, setting: { urlCheck: true } });
    git('add', 'project.config.json');
    git('commit', '-q', '-m', 'baseline');
  });

  afterEach(() => {
    if (!gitAvailable) return;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('磁盘与 HEAD 一致 → 零差异（不制造假红）', () => {
    if (!gitAvailable) return;
    expect(setup.readCommittedProjectConfig(dir).tracked).toBe(true);
    expect(setup.diffAgainstCommitted([dir])).toEqual([]);
  });

  it('🔴 磁盘被改脏（回写发生在本进程之前）→ 报 changed 并指认叶子 key', () => {
    if (!gitAvailable) return;
    // 关键：快照/基线在此之前没被本进程读过，等价于「上一轮 E2E 把文件改脏了，现在才跑测试」
    const obj = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    obj.setting = Object.assign({}, obj.setting, { isGameTourist: true });
    writeCfg(obj);

    const diffs = setup.diffAgainstCommitted([dir]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('changed');
    expect(diffs[0].tier).toBe('committed');
    expect(diffs[0].keys.map((k: KeyDiff) => k.key)).toContain('setting.isGameTourist');

    const msg = setup.formatDiffMessage(diffs);
    expect(msg).toContain('setting.isGameTourist');
    expect(msg).toContain('git checkout --');
    // 提交基线层**不还原**磁盘（可能是有意改的，写回会毁掉人的工作）
    expect(fs.readFileSync(cfg, 'utf8')).toContain('isGameTourist');
  });

  it('guard().verify() 在「本进程之前就脏」时也返回 ok=false（这是只靠内存快照必漏的场景）', () => {
    if (!gitAvailable) return;
    // 先改脏，再建守卫 —— 复刻「回写发生在另一个进程」的真实现场
    const obj = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    obj.setting = Object.assign({}, obj.setting, { isGameTourist: true });
    writeCfg(obj);

    const g = setup.guardProjectConfigs([dir]);
    // 内存快照这一层看不出任何差异（自己跟自己比）
    expect(setup.diffProjectConfigs(g.snapshot)).toEqual([]);
    // 提交基线这一层必须红
    const result = g.verify();
    expect(result.ok).toBe(false);
    expect(result.diffs.some((d: ConfigDiff) => d.tier === 'committed')).toBe(true);
    expect(result.message).toContain('对不上提交基线');
  });

  it('文件被删 → 提交基线层报 deleted（不抛）', () => {
    if (!gitAvailable) return;
    fs.rmSync(cfg);
    const diffs = setup.diffAgainstCommitted([dir]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('deleted');
    expect(diffs[0].tier).toBe('committed');
  });

  it('没有提交基线（非 git 目录）→ 跳过，不制造假红', () => {
    if (!gitAvailable) return;
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'pcnogit-'));
    try {
      fs.writeFileSync(path.join(plain, 'project.config.json'), '{"appid":"wx9"}\n');
      expect(setup.readCommittedProjectConfig(plain).tracked).toBe(false);
      expect(setup.diffAgainstCommitted([plain])).toEqual([]);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

/**
 * 🔴 守卫的**第一信号**：把判定搬进测试体，让 jest 摘要行直接出 `Tests: 1 failed`。
 *
 * 为什么需要：红在 `afterAll` 里 `throw` 时，jest 只算「失败的 suite」，摘要行仍是
 * `Tests: N passed` —— 谁 grep `Tests:` 就会把这套件判成绿，守卫等于被静默绕过
 * （CI 不受影响：exit code 非零，但人工/agent 复核日志时不成立）。
 *
 * 呈现形式（实测，别照直觉写）：默认 reporter 下会多出一条独立的
 * `● <describe> › <用例名>` 失败块、摘要行变 `Tests: 1 failed`；
 * 但 **`✕` 字形只在 `--verbose` 下出现** —— 单套件运行时 jest 会自动 verbose，最容易被这个骗。
 *
 * 🔴 本用例**必须是文件内最后一个**：run 层（内存快照）的保护窗口 = `beforeAll` → 本用例，
 * 往后追加用例会让它在文件中途提前跑，窗口变短（追加用例若弄脏文件，快照已消费、run 层抓不到）。
 * committed 层不受顺序影响 —— `afterAll` 的 `verify()` 每次都重读磁盘与 `git show HEAD`，
 * 会再报一次同一件事实（第二信号；**不宣称兜 teardown**：run 层已被本用例还原，中间无代码）。
 *
 * 🔴 为什么套一层 describe 而不是写成裸 `it`：实测 jest 的**显示顺序与执行顺序相反** ——
 * 顶层 `it` 即便声明在所有 describe 之后（执行确实最后），reporter 也把它排在列表**最前面**，
 * 于是叫「[必须最后]」的用例显示在第一行，读日志的人正好读反（`d1-a → d1-b → guard` 执行，
 * 显示却是 `guard` 在最上）。包进「声明在最后的 describe」后：执行仍最后、显示也落在最后。
 */
describe('提交基线守卫（必须最后）', () => {
  it('🔴 [必须最后] 磁盘 project.config.json 与 HEAD 一致（无回写）', () => {
    const result = guard.verify();
    // 失败时把整段 message（含 key 级 diff + 两条出路）原样落进断言差异里
    expect(result.ok ? '' : result.message).toBe('');
  });
});
