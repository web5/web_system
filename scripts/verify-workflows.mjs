#!/usr/bin/env node
/**
 * 校验 .github/workflows/{auto-pr,auto-merge}.yml —— 语法 + 行为 +（可选）线上 GraphQL schema
 *
 * 为什么要这个脚本（两条都是 2026-10-23 真实踩过的，且都靠人眼看日志发现不了）：
 *
 *  1. `github.rest.pulls.enableAutoMerge` 在 octokit 里**不存在**（#396）。抛 TypeError
 *     被 catch 成 warning → job 恒绿 → 「PR 全绿自动合入」这条承诺从未生效过。
 *     → 用例 1–4：mock 出「挂上 / 已挂 / 已合并 / mutation 名被改错」四种情形，
 *       负向必须让 auto-merge 判红，否则静默会再来一次。
 *
 *  2. `expectedHeadOid` 要 `GitObjectID!`，写成 `String!` 线上必挂（#409）；而 mock 对
 *     GraphQL 变量类型**照单全收**，当时三个用例全绿。→ 用例 8 做静态断言（离线可跑），
 *     `--schema` 再拿 introspection 对准线上真 schema（这是唯一能证明"方法真的存在"的手段）。
 *
 * 用法：
 *   node scripts/verify-workflows.mjs            # 离线：YAML + 脚本语法 + mock 行为
 *   node scripts/verify-workflows.mjs --schema   # 额外核线上 schema（需 gh 已登录）
 *   node scripts/verify-workflows.mjs --verbose  # 打印每个用例的日志细节
 * 退出码：0 全通过 / 1 有失败项
 *
 * 明确不做：
 *  - 不接 CI。`--schema` 需要 gh 认证与联网；CI 侧该管的是「YAML 结构是否合法」，
 *    不是「GraphQL schema 是否还记得我们」。本地改完 workflow 跑一次即可。
 *  - 不 mock GraphQL 的 schema 校验本身（做不到：假 graphql 只会照单全收），
 *    所以用例静态断言与 `--schema` 是**并列的两层**，缺一层就等于没测。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// 可选 YAML 库用 require 探测（两者在本仓库都只是传递依赖），ESM 下没有 require 故自建一个。
const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WF_DIR = path.join(ROOT, '.github/workflows');
const FILES = ['auto-pr.yml', 'auto-merge.yml'];

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(
    'usage: node scripts/verify-workflows.mjs [--schema] [--verbose]\n' +
      '  --schema   核对线上 GraphQL schema（需 gh 已登录；不加则只跑离线用例）\n' +
      '  --verbose  打印每个用例的 mock 日志',
  );
  process.exit(0);
}
const WITH_SCHEMA = argv.includes('--schema');
const VERBOSE = argv.includes('--verbose');

// ─────────────────────────── 断言收集 ───────────────────────────
const results = [];
function t(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (VERBOSE && detail) console.log(`   · ${name}: ${detail}`);
  return !!ok;
}

// ─────────────────────────── 1. YAML 解析 ───────────────────────────
// 依赖阶梯而不是硬写一个库：js-yaml / yaml 在本仓库都只是传递依赖（没有显式声明），
// 换 lockfile 就可能被提掉；两者都没有时退回 ruby（macOS 与 ubuntu-latest 均自带）。
function checkYaml(file) {
  const abs = path.join(WF_DIR, file);
  for (const [mod, parse] of [
    ['js-yaml', (m) => m.load(fs.readFileSync(abs, 'utf8'))],
    ['yaml', (m) => m.parse(fs.readFileSync(abs, 'utf8'))],
  ]) {
    let m;
    try {
      m = require(mod);
    } catch (e) {
      if (e && e.code === 'MODULE_NOT_FOUND') continue;
      throw e;
    }
    parse(m); // 语法错会抛，交给调用方判 FAIL
    return mod;
  }
  execSync(`ruby -ryaml -e 'YAML.load_file(${JSON.stringify(abs)})'`, { stdio: 'pipe' });
  return 'ruby';
}

for (const f of FILES) {
  try {
    const via = checkYaml(f);
    t(`yaml:${f}`, true, `通过（${via}）`);
  } catch (e) {
    t(`yaml:${f}`, false, String(e.message || e).split('\n')[0]);
  }
}

// ─────────────────────────── 2. 抽 script: | 块并查语法 ───────────────────────────
function extractScripts(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)script:\s*\|\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    const buf = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') {
        buf.push('');
        continue;
      }
      if (l.match(/^\s*/)[0].length <= indent) break;
      buf.push(l);
    }
    out.push(buf.join('\n'));
  }
  return out;
}

const texts = {};
const blocks = {};
for (const f of FILES) {
  texts[f] = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
  blocks[f] = extractScripts(texts[f]);
  blocks[f].forEach((s, i) => {
    try {
      new vm.Script(`(async () => {\n${s}\n})`); // 包 async 体：块里有顶层 await
      t(`syntax:${f}#${i}`, true, `${s.split('\n').length} 行`);
    } catch (e) {
      t(`syntax:${f}#${i}`, false, e.message);
    }
  });
}

// 按内容定位块，不用下标 —— 加一个 step 就会让 blocks[1] 静默指错，而"测了别的东西"
// 和"测过了"在输出上长得一样。
const findBlock = (file, needle) => (blocks[file] || []).find((s) => s.includes(needle));
const enableMerge = findBlock('auto-merge.yml', 'enablePullRequestAutoMerge');
const syncBlock = findBlock('auto-merge.yml', 'updatePullRequestBranch');
const prBlock = findBlock('auto-pr.yml', 'enablePullRequestAutoMerge');

t('blocks:auto-merge 的挂合入块', !!enableMerge, enableMerge ? '已定位' : '找不到含 enablePullRequestAutoMerge 的 script 块');
t('blocks:auto-merge 的同步块', !!syncBlock, syncBlock ? '已定位' : '找不到含 updatePullRequestBranch 的 script 块');
t('blocks:auto-pr 的 script 块', !!prBlock, prBlock ? '已定位' : '找不到含 enablePullRequestAutoMerge 的 script 块');

// ─────────────────────────── 3. 静态断言（离线可跑，防历史回归） ───────────────────────────
// 只看代码，不看注释：这两个文件里恰好有一段注释在解释「为什么不要用 rest.pulls.enableAutoMerge」，
// 拿全文正则去查会把正确的注释判成违规（第一版就是这么误报的）。
const codeOnly = (text) =>
  text
    .split('\n')
    .filter((l) => !/^\s*(\/\/|#)/.test(l))
    .join('\n');

for (const f of FILES) {
  t(
    `static:${f} 无 rest.pulls.enableAutoMerge`,
    !/rest\.pulls\.enableAutoMerge/.test(codeOnly(texts[f])),
    'REST 没有 enable 动作（#396 根因），必须走 GraphQL',
  );
  t(
    `static:${f} 用 GraphQL enablePullRequestAutoMerge`,
    /enablePullRequestAutoMerge/.test(texts[f]),
    '回查断言依赖这个 mutation 名',
  );
}
t(
  'static:sync 的 $oid 声明为 GitObjectID!',
  !!syncBlock && /\$oid:\s*GitObjectID!/.test(syncBlock) && !/\$oid:\s*String/.test(syncBlock),
  '写成 String! 线上报 Type mismatch（#409，mock 测不出来所以这条必须静态断言）',
);

// ── master 前进触发（2026-10-23，修 #407 残留缺口）──
// 用一句日志文本当锚点，而不是块下标：加 step 会让下标静默指错（见上面 findBlock 的注释）。
const masterSyncBlock = findBlock('auto-merge.yml', '扫描 master 前进后落后的开放 PR');
t(
  'blocks:auto-merge 的 master 前进同步块',
  !!masterSyncBlock,
  masterSyncBlock ? '已定位' : '找不到含「扫描 master 前进后落后的开放 PR」的 script 块',
);
t(
  'static:auto-merge 监听 master push',
  /\n\s*push:\s*\n\s*branches:\s*\[\s*master\s*\]/.test(texts['auto-merge.yml']),
  '缺这个触发点：master 前进不产生 pull_request 事件，落后的 PR 永远等不到同步（#417 实测：BEHIND 后 #418/#419 合入仍纹丝不动）',
);
t(
  'static:master 同步块的 $oid 声明为 GitObjectID!',
  !!masterSyncBlock && /\$oid:\s*GitObjectID!/.test(masterSyncBlock) && !/\$oid:\s*String/.test(masterSyncBlock),
  '同一坑第二次：新块也要 GitObjectID!（#409）',
);
// 只看代码行不看注释：这两个块里的注释**正是在解释「为什么不要用」**，
// 全文正则会把它判成违规（本项目第三次踩这个坑，第一次是 rest.pulls.enableAutoMerge）。
const codeOnlyJs = (txt) =>
  txt
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
t(
  'static:两个同步块都不用 pr.base.sha 当基准',
  !!syncBlock &&
    !!masterSyncBlock &&
    !/pr\.base\.sha/.test(codeOnlyJs(syncBlock)) &&
    !/pr\.base\.sha/.test(codeOnlyJs(masterSyncBlock)),
  'pr.base.sha 是 PR 记录里的 base，master 前进后不更新 —— 拿它比对会把「落后」判成「已同步」（#417 实测，落后 PR 被永远跳过）',
);
t(
  'static:两个同步块都不靠 mergeable_state 判落后',
  !!syncBlock &&
    !!masterSyncBlock &&
    !/mergeable_state/.test(codeOnlyJs(syncBlock)) &&
    !/mergeable_state/.test(codeOnlyJs(masterSyncBlock)),
  'mergeable_state 是异步缓存：master 刚前进时十几秒都是 unknown（实测 15 秒轮询仍 unknown），而「master 刚前进」正是本 job 的启动时刻 → 改用 compareCommits',
);

// ─────────────────────────── 4. mock 运行器 ───────────────────────────
function newSandbox({ github, core, context }) {
  const sandbox = {
    github,
    core: core || {},
    context,
    console: { log: () => {}, warn: () => {} },
    // 同步块里 `await new Promise(r => setTimeout(r, 3000))` 等的是 GitHub 异步计算，
    // 测试里立即兑现即可 —— 否则每次跑都要真等 3 秒。
    setTimeout: (fn) => {
      fn();
      return 0;
    },
  };
  vm.createContext(sandbox);
  return sandbox;
}

const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

function exec(script, sandbox) {
  vm.runInContext(
    `(async () => {\n${script}\n})().catch((e) => { globalThis.__err = String((e && e.message) || e); })`,
    sandbox,
  );
}

// ── 4.1 挂自动合入（enable / auto-pr 共用一套 mock） ──
function runEnable(script, { recognize = true, presetAutoMerge = null, state = 'OPEN' } = {}) {
  const st = { autoMerge: presetAutoMerge, mutations: [], failed: [], warnings: [], logs: [] };
  const pr = {
    id: 'PR_node_1',
    state,
    isDraft: false,
    get autoMergeRequest() {
      return st.autoMerge;
    },
  };
  const github = {
    graphql: async (q, vars) => {
      if (q.includes('mutation')) {
        st.mutations.push(vars);
        // 负向场景：mutation 名被改错 → 后端不认 → 状态不变（模拟「静默不生效」）
        if (recognize && q.includes('enablePullRequestAutoMerge')) {
          st.autoMerge = { enabledAt: '2026-10-23T00:00:00Z', mergeMethod: vars.m || 'MERGE' };
        }
        return { enablePullRequestAutoMerge: { pullRequest: { number: 1001 } } };
      }
      return { repository: { pullRequest: pr } };
    },
    rest: {
      pulls: {
        list: async () => ({ data: [] }),
        create: async () => ({
          data: { number: 1001, id: 1, node_id: 'PR_node_1', html_url: 'https://example/1001' },
        }),
      },
      repos: { compareCommits: async () => ({ data: { commits: [{ commit: { message: 'test commit' } }] } }) },
      issues: { get: async () => ({ data: { state: 'open', pull_request: undefined } }) },
    },
  };
  const context = {
    repo: { owner: 'web5', repo: 'web_system' },
    payload: { pull_request: { number: 999 } },
    ref: 'refs/heads/chore/999-x', // 不含 issue 编号，避免 Closes 分支影响断言
  };
  const sandbox = newSandbox({
    github,
    context,
    core: {
      setFailed: (m) => st.failed.push(m),
      warning: (m) => st.warnings.push(m),
      notice: (m) => st.logs.push(m),
      info: () => {},
    },
  });
  sandbox.console = { log: (m) => st.logs.push(String(m)), warn: () => {} };
  exec(script, sandbox);
  return st;
}

// ── 4.2 落后同步（compareCommits 判据 + graphql 写） ──
// compare: compareCommits 返回的 status —— behind/identical = head 已含 tip；diverged/ahead = 落后
function runSync(script, { compare = 'diverged', baseTip = 'tip999', graphqlFails = false } = {}) {
  const st = { mutations: [], notices: [], warnings: [], failed: [], logs: [] };
  const github = {
    rest: {
      pulls: {
        get: async () => ({
          // 故意让 pr.base.sha 与「当前 tip」不同：用 pr.base.sha 当基准的写法会把
          // diverged 误判成已同步（#417 实测的真 bug，见下方静态断言）
          data: { node_id: 'PR_node_407', head: { sha: 'head111' }, base: { ref: 'master', sha: 'stale-base' } },
        }),
      },
      repos: {
        getBranch: async () => ({ data: { commit: { sha: baseTip } } }),
        compareCommits: async () => ({ data: { status: compare, behind_by: 1 } }),
      },
    },
    graphql: async (q, vars) => {
      if (!q.includes('updatePullRequestBranch')) {
        throw new Error("Field 'updateBranch' doesn't exist on type 'Mutation'");
      }
      if (graphqlFails) throw new Error('boom');
      st.mutations.push(vars);
      return { updatePullRequestBranch: { pullRequest: { number: 407 } } };
    },
  };
  const context = { repo: { owner: 'web5', repo: 'web_system' }, payload: { pull_request: { number: 407 } } };
  const sandbox = newSandbox({
    github,
    context,
    core: {
      notice: (m) => st.notices.push(m),
      warning: (m) => st.warnings.push(m),
      setFailed: (m) => st.failed.push(m),
      info: () => {},
    },
  });
  sandbox.console = { log: (m) => st.logs.push(String(m)), warn: () => {} };
  exec(script, sandbox);
  return st;
}

// ── 4.3 master 前进后批量同步（push 事件，无 pull_request 上下文） ──
// prs: [{ number, draft?, fork?, compare?, parents? }]
function runMasterSync(script, prs, { after = null, graphqlFails = false } = {}) {
  const st = { mutations: [], notices: [], warnings: [], failed: [], logs: [], branchReads: 0 };
  const byNumber = {};
  for (const p of prs) byNumber[p.number] = p;
  const github = {
    rest: {
      pulls: {
        list: async () => ({
          data: prs.map((p) => ({
            number: p.number,
            draft: !!p.draft,
            head: { repo: { full_name: p.fork ? 'someone/else' : 'web5/web_system' } },
          })),
        }),
        get: async ({ pull_number }) => ({
          data: {
            number: pull_number,
            node_id: `PR_${pull_number}`,
            head: { sha: `head${pull_number}` },
            base: { ref: 'master', sha: 'stale-base' },
          },
        }),
      },
      repos: {
        // push 事件带了 payload.after 时**不该**再问 API —— 调了就抛，让用例当场红
        getBranch: async () => {
          st.branchReads += 1;
          if (after) throw new Error('有 payload.after 时不该调用 getBranch');
          return { data: { commit: { sha: 'tip999' } } };
        },
        compareCommits: async ({ base }) => {
          const num = Number(String(base).replace('head', ''));
          const p = byNumber[num] || {};
          return { data: { status: p.compare || 'diverged', behind_by: 1 } };
        },
      },
    },
    graphql: async (q, vars) => {
      if (!q.includes('updatePullRequestBranch')) {
        throw new Error("Field 'updateBranch' doesn't exist on type 'Mutation'");
      }
      if (graphqlFails) throw new Error('boom');
      st.mutations.push(vars);
      return { updatePullRequestBranch: { pullRequest: { number: 0 } } };
    },
  };
  // push 事件：payload 里没有 pull_request —— 脚本如果误读 context.payload.pull_request 会当场挂
  const context = { repo: { owner: 'web5', repo: 'web_system' }, payload: after ? { after } : {} };
  const sandbox = newSandbox({
    github,
    context,
    core: {
      notice: (m) => st.notices.push(m),
      warning: (m) => st.warnings.push(m),
      setFailed: (m) => st.failed.push(m),
      info: () => {},
    },
  });
  sandbox.console = { log: (m) => st.logs.push(String(m)), warn: () => {} };
  exec(script, sandbox);
  return st;
}

// ─────────────────────────── 5. 行为用例 ───────────────────────────
(async () => {
  if (enableMerge) {
    // 1. 首次：真的挂上
    let s = runEnable(enableMerge);
    await tick();
    t(
      'behave:首次挂载成功',
      s.mutations.length === 1 && s.failed.length === 0 && s.logs.join(' ').includes('已启用自动合入'),
      `mutation=${s.mutations.length} setFailed=${s.failed.length}`,
    );

    // 2. 已挂：幂等跳过，不发 mutation
    s = runEnable(enableMerge, { presetAutoMerge: { enabledAt: 'x', mergeMethod: 'MERGE' } });
    await tick();
    t(
      'behave:已挂则幂等跳过',
      s.mutations.length === 0 && s.failed.length === 0 && s.logs.join(' ').includes('幂等跳过'),
      `mutation=${s.mutations.length}`,
    );

    // 3. 已合并/已关闭：不发 mutation，不报错
    s = runEnable(enableMerge, { state: 'MERGED' });
    await tick();
    t(
      'behave:非 OPEN 不挂',
      s.mutations.length === 0 && s.failed.length === 0 && s.logs.join(' ').includes('无需挂自动合入'),
      `state=MERGED mutation=${s.mutations.length}`,
    );

    // 4. 负向：mutation 名改错 → 必须判红（这是 #396 的回归判据）
    s = runEnable(enableMerge.replace(/enablePullRequestAutoMerge/g, 'enableAutoMerge'));
    await tick();
    t(
      'behave:负向-mutation 名错必须判红',
      s.failed.length > 0,
      s.failed[0] ? s.failed[0].slice(0, 90) : 'setFailed 未被调用 —— 又静默了',
    );
  }

  if (prBlock) {
    // 5. 正向：建 PR 后挂上，无 warning
    let s = runEnable(prBlock);
    await tick();
    t(
      'behave:auto-pr 建 PR 后挂上',
      s.mutations.length === 1 && s.warnings.length === 0 && s.logs.join(' ').includes('已启用自动合入'),
      `mutation=${s.mutations.length} warnings=${s.warnings.length}`,
    );

    // 6. 负向：本文件只 warning 不判红（建 PR 才是主职责，判红由 auto-merge.yml 负责）
    s = runEnable(prBlock.replace(/enablePullRequestAutoMerge/g, 'enableAutoMerge'));
    await tick();
    t(
      'behave:auto-pr 负向只 warning 不判红',
      s.warnings.length > 0 && s.failed.length === 0,
      `warnings=${s.warnings.length} setFailed=${s.failed.length}`,
    );
  }

  if (syncBlock) {
    // 7. diverged（正常 PR 的最常见形态：head 缺 master 的新提交）→ 必须同步
    let s = runSync(syncBlock, { compare: 'diverged' });
    await tick();
    t(
      'behave:diverged 触发同步',
      s.mutations.length === 1 && s.mutations[0].oid === 'head111' && s.notices.length === 1,
      `mutation=${s.mutations.length} oid=${s.mutations[0] && s.mutations[0].oid}`,
    );

    // 8. behind（tip 是 head 的祖先 → head 已含 master）→ 跳过，别白跑一轮 CI
    s = runSync(syncBlock, { compare: 'behind' });
    await tick();
    t(
      'behave:head 已含 tip 则跳过（安全阀）',
      s.mutations.length === 0 && s.logs.join(' ').includes('无需同步分支'),
      `mutation=${s.mutations.length}`,
    );

    // 9. identical（同一个提交）→ 跳过
    s = runSync(syncBlock, { compare: 'identical' });
    await tick();
    t('behave:identical 跳过', s.mutations.length === 0, `mutation=${s.mutations.length}`);

    // 10. ahead（head 是 tip 的祖先，PR 自己没有提交）→ 也要同步
    s = runSync(syncBlock, { compare: 'ahead' });
    await tick();
    t('behave:ahead 也要同步', s.mutations.length === 1, `mutation=${s.mutations.length}`);

    // 11. 同步失败 → 只 warning 不判红（补齐条件失败 ≠ 该不该合被破坏）
    s = runSync(syncBlock, { compare: 'diverged', graphqlFails: true });
    await tick();
    t(
      'behave:同步失败只 warning',
      s.warnings.length === 1 && s.failed.length === 0,
      `warnings=${s.warnings.length} setFailed=${s.failed.length}`,
    );
  }

  if (masterSyncBlock) {
    // 12. 混合一轮：diverged 的同步、identical 的不动、草稿跳过、fork 跳过
    let s = runMasterSync(masterSyncBlock, [
      { number: 501, compare: 'diverged' },
      { number: 502, compare: 'identical' },
      { number: 503, draft: true },
      { number: 504, fork: true },
    ]);
    await tick();
    t(
      'behave:master 前进后只同步落后的 PR',
      s.mutations.length === 1 &&
        s.mutations[0].id === 'PR_501' &&
        s.mutations[0].oid === 'head501' &&
        s.notices.length === 1 &&
        s.failed.length === 0,
      `mutation=${s.mutations.length}（应 1，且只打 #501）draft/fork 被误动即为错`,
    );

    // 13. 全部已含 tip → 一个都不动
    s = runMasterSync(masterSyncBlock, [
      { number: 505, compare: 'behind' },
      { number: 506, compare: 'identical' },
    ]);
    await tick();
    t('behave:都最新则不动', s.mutations.length === 0, `mutation=${s.mutations.length}`);

    // 14. push 事件必须用 payload.after 当基准（零 API），不能退回去问 getBranch
    s = runMasterSync(masterSyncBlock, [{ number: 507, compare: 'diverged' }], { after: 'newmaster1' });
    await tick();
    t(
      'behave:push 事件用 payload.after 当基准',
      s.mutations.length === 1 && s.branchReads === 0,
      `mutation=${s.mutations.length} branchReads=${s.branchReads}（应 0：payload.after 已够，多问一次 API 就是浪费）`,
    );

    // 15. 非 push 场景（没有 after）→ 退回 API 取 base tip，仍然能同步
    s = runMasterSync(masterSyncBlock, [{ number: 508, compare: 'diverged' }]);
    await tick();
    t(
      'behave:无 payload.after 时退回 API 取 tip',
      s.mutations.length === 1 && s.branchReads === 1,
      `mutation=${s.mutations.length} branchReads=${s.branchReads}`,
    );

    // 16. 同步失败 → 只 warning
    s = runMasterSync(masterSyncBlock, [{ number: 509, compare: 'diverged' }], { graphqlFails: true });
    await tick();
    t(
      'behave:master 同步失败只 warning',
      s.warnings.length === 1 && s.failed.length === 0,
      `warnings=${s.warnings.length} setFailed=${s.failed.length}`,
    );
  }

  // ───────────────────── 6. 线上 schema（--schema） ─────────────────────
  if (WITH_SCHEMA) {
    const gql = (q) =>
      JSON.parse(execSync(`gh api graphql -f query=${JSON.stringify(q)}`, { encoding: 'utf8' })).data;

    try {
      // 6.1 mutation 是否真的存在 —— #396 的本质就是"方法不存在却以为存在"
      const mutationFields = gql('{ __type(name:"Mutation"){ fields{ name } } }').__type.fields.map((f) => f.name);
      for (const m of ['enablePullRequestAutoMerge', 'updatePullRequestBranch']) {
        t(`schema:Mutation.${m} 存在`, mutationFields.includes(m), mutationFields.includes(m) ? '' : '线上 schema 里没有这个 mutation');
      }

      // 6.2 expectedHeadOid 的真实类型 vs workflow 里声明的类型
      const fields = gql('{ __type(name:"UpdatePullRequestBranchInput"){ inputFields{ name type{ name ofType{ name } } } } }')
        .__type.inputFields;
      const typeOf = {};
      for (const f of fields) typeOf[f.name] = f.type.name || (f.type.ofType && f.type.ofType.name) || null;
      const declared = (syncBlock.match(/\$oid:\s*([A-Za-z]+)!?/) || [])[1];
      t(
        'schema:expectedHeadOid 类型与声明一致',
        !!declared && declared === typeOf.expectedHeadOid,
        `线上=${typeOf.expectedHeadOid} 声明=${declared}`,
      );

      // 6.3 枚举取值必须在线上枚举里
      const enums = (name) =>
        gql(`{ __type(name:"${name}"){ enumValues{ name } } }`).__type.enumValues.map((v) => v.name);
      const usedMethod = (syncBlock.match(/updateMethod:\s*([A-Z]+)/) || [])[1];
      const branchMethods = enums('PullRequestBranchUpdateMethod');
      t(
        'schema:updateMethod 取值合法',
        branchMethods.includes(usedMethod),
        `${usedMethod} ∈ [${branchMethods.join(',')}]`,
      );
      const mergeMethods = enums('PullRequestMergeMethod');
      t('schema:mergeMethod 取值合法', mergeMethods.includes('MERGE'), `MERGE ∈ [${mergeMethods.join(',')}]`);
    } catch (e) {
      t('schema:核对线上 schema', false, `gh 调用失败：${String(e.message || e).split('\n')[0]}`);
    }
  }

  // ─────────────────────────── 7. 汇总 ───────────────────────────
  const failed = results.filter((r) => !r.ok);
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
  console.log('');
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${pad(r.name, 42)} ${r.detail || ''}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} 通过` +
      (WITH_SCHEMA ? '' : '（未含线上 schema；加 --schema 可核 GraphQL 类型）'),
  );
  if (failed.length) {
    console.log('\n失败项：');
    failed.forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
  }
  process.exit(failed.length ? 1 : 0);
})();
