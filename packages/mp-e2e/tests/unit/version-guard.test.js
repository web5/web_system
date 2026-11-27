/**
 * version-guard 单测 —— 判定矩阵逐格覆盖（含「未设变量绝不抛」「设了不匹配必抛」两条红线）
 *
 * 全部用假 `execFileSync`，不依赖本仓库当前 git 状态：
 *   真跑 `git` 的话，断言会随「当前分支/是否脏」漂移，等于把测试绑在开发者的工作区上。
 *
 * 2026-11-28 盲测发现：原 ⑫ 与设计文档写反，已按「声明了期望就必须核对」修正
 *   （拆成 ⑫a「共享层缺失 + 未设变量 → 不抛」与 ⑫b「共享层缺失 + 设了变量 → 必抛」）。
 */

const path = require('path');
const { checkVersionConsistency, EXPECT_SHA_ENV, SHARED_IDENTITY_PATH, parseShaListFallback } = require('../../src/version-guard');

const PROJECT = '/tmp/mp-app-fixture';

/** 造一个假 git：按子命令返回固定输出（args 形如 ['-C', root, 'rev-parse', '--short', 'HEAD']） */
function fakeGit({ branch = 'feat/demo', sha = 'abc1234', toplevel = '/repo', status = '' } = {}) {
  return (cmd, args) => {
    expect(cmd).toBe('git');
    const rest = args.slice(2).join(' '); // 跳过 '-C' <root>
    switch (rest) {
      case 'rev-parse --abbrev-ref HEAD':
        return `${branch}\n`;
      case 'rev-parse --short HEAD':
        return `${sha}\n`;
      case 'rev-parse --show-toplevel':
        return `${toplevel}\n`;
      case 'status --short':
        // 注意：readGitIdentity 只去掉结尾换行，前导空格必须保留（" M path" ≠ "M  path"）
        return status ? `${status}\n` : '';
      default:
        throw new Error(`假 git 未实现子命令：${rest}`);
    }
  };
}

/** 造一个「git 不可用」的假实现（非 git 工作区 / 没装 git 都表现为抛错） */
function failingGit(message = 'fatal: not a git repository (or any of the parent directories)') {
  return () => {
    throw new Error(message);
  };
}

/** 跑一次守卫，收集打印行 */
function runGuard({ env = {}, execFileSync = fakeGit(), loadIdentity } = {}) {
  const lines = [];
  const result = checkVersionConsistency({
    projectPath: PROJECT,
    env,
    execFileSync,
    log: (s) => lines.push(String(s)),
    ...(loadIdentity ? { loadIdentity } : {}),
  });
  return { result, lines, text: lines.join('\n') };
}

/** 跑一次守卫并捕获异常（期望 throw 的用例用） */
function catchGuard(opts = {}) {
  try {
    const r = runGuard(opts);
    return { err: null, ...r };
  } catch (e) {
    return { err: e, lines: [], text: '' };
  }
}

describe('version-guard 判定矩阵', () => {
  test('① 未设 MP_E2E_EXPECT_SHA + 正常 git → 只打印 branch@sha，不判定不抛错', () => {
    const { result, text } = runGuard({ env: {} });
    expect(text).toContain('[mp-e2e] 版本：feat/demo@abc1234');
    expect(text).not.toContain('版本一致性 OK'); // 未声明期望就不许打「一致性」结论
    expect(result).toEqual({ ok: true, sha: 'abc1234', branch: 'feat/demo', dirty: false, matched: null });
  });

  test('② 未设变量 + git 不可用 → 打印「无法读取」，不失败（默认路径绝不因 git 缺失变红）', () => {
    const { result, text } = runGuard({ env: {}, execFileSync: failingGit() });
    expect(text).toContain('[mp-e2e] 版本：无法读取（非 git 工作区或 git 不可用）');
    expect(result).toEqual({ ok: true, sha: '', branch: '', dirty: false, matched: null });
  });

  test('③ dirty + 未设变量 → 追加 warn 一行，但不失败（不污染现有工作流）', () => {
    const { result, text } = runGuard({ env: {}, execFileSync: fakeGit({ status: ' M pages/home/index/index.wxml' }) });
    expect(text).toContain('[mp-e2e] 版本：feat/demo@abc1234');
    expect(text).toContain('[mp-e2e] 版本：（工作区有未提交改动，测的不是已提交版本）');
    expect(result.dirty).toBe(true);
    expect(result.matched).toBeNull();
  });

  test('④ 设了且完全相等 → 打印「版本一致性 OK」，matched=true', () => {
    const { result, text } = runGuard({ env: { [EXPECT_SHA_ENV]: 'abc1234' } });
    expect(text).toContain('[mp-e2e] 版本一致性 OK');
    expect(result.matched).toBe(true);
    expect(result.sha).toBe('abc1234');
  });

  test('⑤ 前缀匹配：期望给全 sha、实际短 sha → 命中', () => {
    const full = 'abc1234deadbeef1234567890abcdef12345678';
    const { result, text } = runGuard({ env: { [EXPECT_SHA_ENV]: full } });
    expect(text).toContain('[mp-e2e] 版本一致性 OK');
    expect(result.matched).toBe(true);
  });

  test('⑥ 大小写不敏感：期望大写 → 命中', () => {
    const { result } = runGuard({ env: { [EXPECT_SHA_ENV]: 'ABC1234' } });
    expect(result.matched).toBe(true);
  });

  test('⑦ 逗号多候选：命中其中任意一个即可（第二个命中）', () => {
    const { result, text } = runGuard({ env: { [EXPECT_SHA_ENV]: 'deadbeef, abc1234 ,' } });
    expect(text).toContain('[mp-e2e] 版本一致性 OK');
    expect(result.matched).toBe(true);
  });

  test('⑧ 设了且不匹配 → 必抛，文案同时含实际 sha / 期望候选 / 被测目录 / 修法', () => {
    const { err } = catchGuard({ env: { [EXPECT_SHA_ENV]: 'deadbeef' } });
    expect(err).toBeTruthy();
    const msg = err.message;
    // 四要素：实际、期望、目录、修法 —— 少任何一个都得靠猜，事故里就是靠这些定位的
    expect(msg).toContain('abc1234');                       // 实际 sha
    expect(msg).toContain('deadbeef');                      // 期望候选
    expect(msg).toContain(PROJECT);                         // 被测目录绝对路径
    expect(msg).toContain(`git -C ${PROJECT} switch`);      // 修法①：切分支
    expect(msg).toContain(EXPECT_SHA_ENV);                  // 修法②：去掉该变量
  });

  test('⑨ 设了多候选但全不匹配 → 抛，且文案列出全部候选（便于一眼看出期望是不是写错了）', () => {
    const { err } = catchGuard({ env: { [EXPECT_SHA_ENV]: 'deadbeef,cafebabe' } });
    expect(err).toBeTruthy();
    expect(err.message).toContain('deadbeef | cafebabe');
    expect(err.message).toContain('abc1234');
  });

  test('⑩ 设了但读不到 git → 必抛（声明了期望就不许静默放过）', () => {
    const { err } = catchGuard({ env: { [EXPECT_SHA_ENV]: 'abc1234' }, execFileSync: failingGit() });
    expect(err).toBeTruthy();
    expect(err.message).toContain('读不到被测目录的 git 身份');
    expect(err.message).toContain('abc1234');   // 期望 sha 要回显
    expect(err.message).toContain(PROJECT);     // 被测目录要回显
    expect(err.message).toContain('not a git repository'); // git 原始报错要透出
  });

  test('⑪ 工作区脏 + 设了且匹配 → 既打 dirty warn 又打 OK（两者不互相吞掉）', () => {
    const { result, text } = runGuard({
      env: { [EXPECT_SHA_ENV]: 'abc1234' },
      execFileSync: fakeGit({ status: 'M  pages/home/index/index.wxml' }),
    });
    expect(text).toContain('（工作区有未提交改动，测的不是已提交版本）');
    expect(text).toContain('[mp-e2e] 版本一致性 OK');
    expect(result).toMatchObject({ dirty: true, matched: true });
  });

  test('⑫a 共享层缺失（mp-e2e 被单独拷走）+ 未设变量 → 只 warn 跳过，不失败', () => {
    const { result, text } = runGuard({ env: {}, loadIdentity: () => null });
    expect(text).toContain('[mp-e2e] warning: 共享层');
    expect(text).toContain('跳过版本一致性校验');
    expect(result).toEqual({ ok: true, sha: '', branch: '', dirty: false, matched: null });
  });

  test('⑫b 共享层缺失 + 设了 MP_E2E_EXPECT_SHA → 必抛（声明了期望就必须能核对）', () => {
    // 2026-11-28 盲测 P1：这条原先和 ⑫a 合并成一句「即使设了变量也不抛」，
    // 与文件头「设了但读不到 git → throw」写反 —— 共享层缺失同样是「读不到 git 身份」。
    const { err } = catchGuard({ env: { [EXPECT_SHA_ENV]: 'deadbeef' }, loadIdentity: () => null });
    expect(err).toBeTruthy();
    expect(err.message).toContain('deadbeef');            // 已声明的期望 sha 必须回显
    expect(err.message).toContain(SHARED_IDENTITY_PATH);  // 缺失的绝对路径必须回显
    expect(err.message).toContain(EXPECT_SHA_ENV);        // 变量名要回显（一眼看出该去掉哪个）
    expect(err.message).toContain('git-identity.js');     // 处置①：指出该确认哪个文件
  });

  test('⑬ 空串 / 纯空白 / 纯逗号的期望值等价于未设（不许把空值当「必须匹配空 sha」）', () => {
    for (const v of ['', '   ', ', ,']) {
      const { result, text } = runGuard({ env: { [EXPECT_SHA_ENV]: v } });
      expect(text).not.toContain('版本一致性 OK');
      expect(result.matched).toBeNull();
    }
  });

  test('⑭ detached HEAD（branch 返回字面量 HEAD）→ 打印裸 sha，不打印 HEAD@sha', () => {
    const { text } = runGuard({ env: {}, execFileSync: fakeGit({ branch: 'HEAD' }) });
    expect(text).toContain('[mp-e2e] 版本：abc1234');
    expect(text).not.toContain('HEAD@');
  });
});

// ═════════════ 共享层判据自身（守守卫：抽取时有没有把手感改坏） ═════════════
describe('共享层 scripts/lib/git-identity.js', () => {
  const shared = require(SHARED_IDENTITY_PATH);

  test('readGitIdentity 保留 status 前导空格（" M path" 与 "M  path" 语义不同）', () => {
    const git = shared.readGitIdentity(PROJECT, fakeGit({ status: ' M a.wxml\nM  b.wxml' }));
    expect(git.ok).toBe(true);
    expect(git.status.startsWith(' M a.wxml')).toBe(true); // 前导空格没被 trim 掉
    expect(git.dirty).toBe(true);
  });

  test('readGitIdentity 无改动时 dirty=false 且 status 为空串', () => {
    const git = shared.readGitIdentity(PROJECT, fakeGit({ status: '' }));
    expect(git).toMatchObject({ ok: true, dirty: false, status: '' });
  });

  test('readGitIdentity git 不可用时不抛，返回 ok:false + error', () => {
    const git = shared.readGitIdentity(PROJECT, failingGit('boom'));
    expect(git.ok).toBe(false);
    expect(git.error).toContain('boom');
    expect(git.dirty).toBe(false);
  });

  test('isSameSha：相等 / 前缀双向 / 大小写不敏感 / 空值 false', () => {
    expect(shared.isSameSha('abc1234', 'abc1234')).toBe(true);
    expect(shared.isSameSha('abc1234', 'abc1234deadbeef')).toBe(true);
    expect(shared.isSameSha('abc1234deadbeef', 'abc1234')).toBe(true);
    expect(shared.isSameSha('ABC1234', 'abc1234')).toBe(true);
    expect(shared.isSameSha('', 'abc')).toBe(false);
    expect(shared.isSameSha('abc', '')).toBe(false);
    expect(shared.isSameSha('abc', 'def')).toBe(false);
  });

  test('parseShaList：逗号分隔 / trim / 去空', () => {
    expect(shared.parseShaList('a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(shared.parseShaList('a,,b,')).toEqual(['a', 'b']);
    expect(shared.parseShaList('')).toEqual([]);
    expect(shared.parseShaList(undefined)).toEqual([]);
    expect(shared.parseShaList(null)).toEqual([]);
  });

  // 🔴 2026-11-28 独立复审（PR #734）：version-guard 的「共享层缺失」分支用的是本地
  //    `parseShaListFallback` —— 它是**同构的第二份实现**。共享层哪天改了分隔符 / trim 规则，
  //    它会静默漂移，而漂移只影响「声明了期望却没被识别」这种最不该出错的地方
  //    （后果就是共享层缺失时守卫又空转回 2026-11-28 盲测 P1）。
  //
  //    所以单独钉一条对拍用例：同一组输入喂给两份实现，**输出必须逐例完全相等**。
  //    输入特意覆盖「边界与易漂移点」：
  //      · 空值三态：undefined / null / ''（`String(raw == null ? '' : raw)` 这层兜底最容易只改一侧）
  //      · 纯空白与纯分隔符：'   ' / ', ,'（trim 与 filter 的先后顺序差异会在这里暴露）
  //      · 前后 / 中间多余逗号：'a, b ,,c,'（去空是否彻底）
  //      · 大小写：'ABC,DEF'（解析层不许做任何大小写归一，归一在 isSameSha 里）
  //      · 中文逗号 'a，b'：**不在分隔符集合内**，必须整串保留为一项
  //      · 换行 'a,\nb'：trim 是否覆盖 \n（不只是半角空格）
  test('parseShaListFallback 与共享层 parseShaList 逐例对拍（同构双实现，不许漂移）', () => {
    const CASES = [
      undefined,                    // 未设变量
      null,
      '',
      '   ',                        // 纯空白
      ', ,',                        // 纯分隔符
      'a',                          // 单值
      'a,b',                        // 正常多值
      'a, b ,,c,',                  // trim + 空项 + 尾逗号
      'ABC,DEF',                    // 大小写必须原样保留
      'a，b',                       // 中文逗号不在分隔符集合内 → 整串一项
      'a,\nb',                      // 换行也要被 trim 掉
      'a , b ,',                    // 空格包住逗号
      ',a',                         // 前导逗号
      'deadbeef, cafebabe ,',
      123,                          // 非字符串入参（String() 兜底）
    ];
    for (const v of CASES) {
      expect({ input: v, out: parseShaListFallback(v) })
        .toEqual({ input: v, out: shared.parseShaList(v) });
    }
    // 样例数下限守卫：将来有人删样例（比如删掉中文逗号那条）必须显式改这里，
    // 而不是静默把鉴别力削薄。
    expect(CASES.length).toBeGreaterThanOrEqual(11);
  });

  test('describeIdentity：正常 branch@sha / detached 裸 sha / git 不可用', () => {
    expect(shared.describeIdentity({ ok: true, branch: 'master', sha: 'abc1234' })).toBe('master@abc1234');
    expect(shared.describeIdentity({ ok: true, branch: 'HEAD', sha: 'abc1234' })).toBe('abc1234');
    expect(shared.describeIdentity({ ok: false })).toBe('(git 不可用)');
    expect(shared.describeIdentity(null)).toBe('(git 不可用)');
  });

  test('共享层路径解析正确（mp-e2e/src → 仓库根 scripts/lib）', () => {
    expect(SHARED_IDENTITY_PATH).toBe(path.resolve(__dirname, '../../../../scripts/lib/git-identity.js'));
  });
});
