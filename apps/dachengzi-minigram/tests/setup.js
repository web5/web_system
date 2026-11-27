// tests/setup.js
// 微信小程序自动化测试环境设置
//
// ⚠️ 这里启动的是**真机 E2E**：automator.launch 会拉起微信开发者工具 GUI，
// 耗时远大于 jest 默认的 5s hook 超时。launch 阶段必须显式给 timeout，
// 否则表现为「9 个用例全红 + Exceeded timeout of 5000 ms for a hook」，
// 而真因只是开发者工具启动慢（2026-10-15 实测）。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const automator = require('miniprogram-automator');

/** macOS 默认路径；可用 WECHAT_DEVTOOLS_CLI 覆盖（换机 / 非标准安装） */
const DEFAULT_CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const CLI_PATH = process.env.WECHAT_DEVTOOLS_CLI || DEFAULT_CLI;

/** 启动开发者工具的耗时上限：拉起 GUI + 首次编译，实测 20s 足够 */
const LAUNCH_TIMEOUT_MS = Number(process.env.MP_AUTOMATOR_LAUNCH_TIMEOUT || 20000);

// ============================================================================
// project.config.json 快照守卫（台账 9143）
// ============================================================================
//
// 🔴 要防的事：真机 E2E（mp-e2e → 微信开发者工具）会**回写** project.config.json
//    —— 已知会往 setting 里塞 isGameTourist，并整体重排版。这份文件的 packOptions
//    决定「哪些文件进包」，它被悄悄改掉 = **下次出码的包内容变了**，
//    而 git 里只表现为一次无关的格式变更，人看不见（2026-11-26 实测命中）。
//
// 用法（见 tests/project-config-snapshot.test.ts）：
//   beforeAll 取快照 → afterAll verify()：有差异就**先还原**、再返回 ok:false
//   让套件红（不是 console.warn —— 警告没人看，红必须有人处理）。
//
// 🔴 两层判据（缺任何一层，这个守卫都是摆设）：
//   · 第一层「运行窗口」（tier=run）：beforeAll 取内存快照，afterAll 比对。
//     抓的是「本次测试运行期间被改」（E2E 拉起开发者工具 → 回写），发现即**还原快照内容**。
//   · 第二层「提交基线」（tier=committed）：磁盘内容 vs `git show HEAD:./project.config.json`。
//     抓的是「上一轮 E2E 把文件改脏了，事后跑测试才被发现」—— 这才是真实事故形态：
//     回写发生在**另一个进程、另一个时间**，第一层的内存快照拍到的已经是脏内容，
//     于是永远绿（2026-11-26 反证实测：脏文件跑本套件 = PASS，证明只靠第一层等于没做）。
//     第二层**不自动还原**（磁盘上可能是有意改的，写回会毁掉人的工作），只报红并给出路。
//
// 口径：
//   · 覆盖两个 app 根（本 app + 同仓 kedou-ai-minigram）：开发者工具会被
//     任何一个 app 的 E2E 拉起，回写的是**被打开的那个** app 根，只守一个漏一个。
//   · 「本来就不存在」不算差异（不因此造空文件）；「被凭空造出来」才算（created）。
//   · 比对按 JSON 顶层 key 粒度，值用 JSON.stringify 比（数组/对象内容变了也算变）；
//     任一边不是合法 JSON 时退化为「整份内容不同」，并在消息里点明 JSON 问题。

const APP_ROOT = path.join(__dirname, '..');
const PROJECT_CONFIG_NAME = 'project.config.json';
/** 默认要守的两个 app 根 */
const PROJECT_CONFIG_APPS = [APP_ROOT, path.join(APP_ROOT, '..', 'kedou-ai-minigram')];

/** 单边 diff 消息里单个值的最大展示长度（超出截断，避免把整份配置刷满屏） */
const VALUE_PREVIEW_MAX = 120;

function projectConfigFile(appRoot) {
  return path.join(appRoot, PROJECT_CONFIG_NAME);
}

/** 取一份快照条目：{ file, exists, raw }。ENOENT 视为「本来就不存在」，不抛 */
function readProjectConfig(appRoot) {
  const file = projectConfigFile(appRoot);
  try {
    return { file, exists: true, raw: fs.readFileSync(file, 'utf8') };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { file, exists: false, raw: null };
    throw e;
  }
}

/**
 * 把各 app 根下的 project.config.json 内容快照到内存。
 * @param {string[]} [appRoots] 默认 PROJECT_CONFIG_APPS
 * @returns {{file: string, exists: boolean, raw: string | null}[]}
 */
function snapshotProjectConfigs(appRoots = PROJECT_CONFIG_APPS) {
  return appRoots.map(readProjectConfig);
}

function preview(value) {
  const s = String(value);
  return s.length > VALUE_PREVIEW_MAX ? `${s.slice(0, VALUE_PREVIEW_MAX)}…` : s;
}

/** 是「普通对象」（能继续往下钻 key），排除 null / 数组 */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 单个 key 的差异条目（值已截断） */
function keyDiff(name, before, after) {
  return { key: name, before: preview(JSON.stringify(before)), after: preview(JSON.stringify(after)) };
}

/**
 * 递归收集差异，**最多下钻 MAX_DEPTH 层**，名字带上路径（`setting.isGameTourist`）。
 *
 * 为什么要下钻：`setting` 这种顶层 key 的值是个几十字段的大对象，只在顶层报
 * 「setting 变了」再截断 120 字符，真正的改动（isGameTourist）根本看不见 ——
 * 而这条守卫的全部价值就是让人一眼看出「哪个字段被动过」。
 */
const MAX_DEPTH = 2;
const MAX_ENTRIES_PER_KEY = 10;

function collectKeyDiffs(prefix, before, after, out, depth) {
  const names = new Set([
    ...Object.keys(isPlainObject(before) ? before : {}),
    ...Object.keys(isPlainObject(after) ? after : {}),
  ]);
  let added = 0;
  for (const name of names) {
    if (added >= MAX_ENTRIES_PER_KEY) {
      out.push(keyDiff(`${prefix}.*`, '<还有更多差异>', '<已截断，最多列 ' + MAX_ENTRIES_PER_KEY + ' 项>'));
      return;
    }
    const bv = isPlainObject(before) ? before[name] : undefined;
    const av = isPlainObject(after) ? after[name] : undefined;
    if (JSON.stringify(bv) === JSON.stringify(av)) continue;
    // 两边都是普通对象且还有下钻额度 → 继续钻，只报叶子差异
    if (depth < MAX_DEPTH && isPlainObject(bv) && isPlainObject(av)) {
      const before2 = out.length;
      collectKeyDiffs(`${prefix}.${name}`, bv, av, out, depth + 1);
      added += out.length - before2;
      continue;
    }
    out.push(keyDiff(`${prefix}.${name}`, bv, av));
    added += 1;
  }
}

/** 顶层 key 级 diff；返回 { keys, parseNote } */
function diffKeys(beforeRaw, afterRaw) {
  let before;
  let after;
  try {
    before = JSON.parse(beforeRaw);
  } catch (e) {
    return { keys: [], parseNote: `快照内容不是合法 JSON（${(e && e.message) || e}）` };
  }
  try {
    after = JSON.parse(afterRaw);
  } catch (e) {
    return { keys: [], parseNote: `当前文件不是合法 JSON（${(e && e.message) || e}）` };
  }
  const keys = [];
  const names = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of names) {
    const bv = before ? before[key] : undefined;
    const av = after ? after[key] : undefined;
    if (JSON.stringify(bv) === JSON.stringify(av)) continue;
    if (isPlainObject(bv) && isPlainObject(av)) {
      const before2 = keys.length;
      collectKeyDiffs(key, bv, av, keys, 1);
      if (keys.length > before2) continue; // 钻到了子 key，已给出可指认的名字
    }
    keys.push(keyDiff(key, bv, av));
  }
  return { keys, parseNote: '' };
}

/**
 * 与快照比对，返回逐文件差异（只含真实差异，无差异返回空数组）。
 * 这一层是「运行窗口」判据：差异都是**本次运行期间**产生的，因此可以安全还原。
 * @returns {{file: string, status: 'changed'|'created'|'deleted', keys: object[], tier: 'run', parseNote?: string}[]}
 */
function diffProjectConfigs(snapshot) {
  const diffs = [];
  for (const snap of snapshot) {
    const now = readProjectConfig(path.dirname(snap.file));
    if (!snap.exists && !now.exists) continue; // 两边都不存在：不算差异
    if (!snap.exists && now.exists) {
      diffs.push({ file: snap.file, status: 'created', keys: [], tier: 'run' });
      continue;
    }
    if (snap.exists && !now.exists) {
      diffs.push({ file: snap.file, status: 'deleted', keys: [], tier: 'run' });
      continue;
    }
    if (snap.raw === now.raw) continue;
    const { keys, parseNote } = diffKeys(snap.raw, now.raw);
    diffs.push(
      parseNote
        ? { file: snap.file, status: 'changed', keys, tier: 'run', parseNote }
        : { file: snap.file, status: 'changed', keys, tier: 'run' },
    );
  }
  return diffs;
}

/**
 * 读某个 app 根的**提交基线**：`git show HEAD:./project.config.json`。
 *
 * 为什么基线必须来自 git 而不是「运行开始时读到的磁盘内容」：开发者工具的回写发生在
 * **另一个进程、另一个时间**（E2E 跑完之后），等测试套件启动时磁盘上早就是脏的了。
 * 拿脏内容当基线，守卫永远绿 —— 这就是「只警告等于没做」的同款空洞。
 *
 * @returns {{file: string, tracked: boolean, raw: string | null, error?: string}}
 *   tracked=false：非 git 仓库 / 该文件没有被 git 跟踪（首次提交前）→ 没有基线可比，跳过、不制造假红。
 */
function readCommittedProjectConfig(appRoot) {
  const file = projectConfigFile(appRoot);
  try {
    const raw = execFileSync('git', ['show', `HEAD:./${PROJECT_CONFIG_NAME}`], {
      cwd: appRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { file, tracked: true, raw };
  } catch (e) {
    return { file, tracked: false, raw: null, error: (e && e.message) || String(e) };
  }
}

/**
 * 「提交基线」判据：磁盘内容 vs `git show HEAD:./project.config.json`。
 *
 * 🔴 本层**不还原**：磁盘上这份改动有可能是人有意改的（临时换 appid 联调等），
 *    自动写回会直接毁掉别人的工作。本层的职责是「让它在测试里红，逼人显式决定」：
 *    不是有意的 → `git checkout -- <file>`；是有意的 → 提交它。两条都不做 = 下次出码包内容与人以为的不同。
 *
 * @param {string[]} [appRoots]
 * @returns {{file: string, status: 'changed'|'created'|'deleted', keys: object[], tier: 'committed', parseNote?: string}[]}
 */
function diffAgainstCommitted(appRoots = PROJECT_CONFIG_APPS) {
  const diffs = [];
  for (const appRoot of appRoots) {
    const base = readCommittedProjectConfig(appRoot);
    if (!base.tracked) continue; // 没有提交基线可比：跳过（非 git / 未跟踪），不制造假红
    const now = readProjectConfig(appRoot);
    if (!now.exists) {
      diffs.push({ file: base.file, status: 'deleted', keys: [], tier: 'committed' });
      continue;
    }
    if (base.raw === now.raw) continue;
    const { keys, parseNote } = diffKeys(base.raw, now.raw);
    diffs.push(
      parseNote
        ? { file: base.file, status: 'changed', keys, tier: 'committed', parseNote }
        : { file: base.file, status: 'changed', keys, tier: 'committed' },
    );
  }
  return diffs;
}

/**
 * 按快照还原：changed/deleted 写回原内容，created 删掉（快照时不存在）。
 * @returns {string[]} 实际被还原的文件路径
 */
function restoreProjectConfigs(snapshot) {
  const restored = [];
  for (const snap of snapshot) {
    if (snap.exists) {
      const now = readProjectConfig(path.dirname(snap.file));
      if (now.exists && now.raw === snap.raw) continue;
      fs.mkdirSync(path.dirname(snap.file), { recursive: true });
      fs.writeFileSync(snap.file, snap.raw);
      restored.push(snap.file);
    } else if (fs.existsSync(snap.file)) {
      fs.unlinkSync(snap.file);
      restored.push(snap.file);
    }
  }
  return restored;
}

/** 人读 + 断言可读的差异摘要：哪几个 key、原值、新值；并标清是「运行窗口」还是「提交基线」 */
function formatDiffMessage(diffs) {
  const hasCommitted = diffs.some((d) => d.tier === 'committed');
  const hasRun = diffs.some((d) => d.tier !== 'committed');
  const lines = ['project.config.json 被改（快照守卫 9143）：'];
  diffs.forEach((d, i) => {
    const where = d.tier === 'committed'
      ? '对不上提交基线 HEAD（历史改动，不是本次测试造成的）'
      : '本次测试运行期间被改';
    lines.push(`  ${i + 1}) ${d.file}  ${d.status}  [${where}]`);
    if (d.status === 'created') {
      lines.push(
        d.tier === 'committed'
          ? '     - 提交基线里没有这个文件，磁盘上却有（工具凭空造的，或漏提交）'
          : '     - 快照时不存在，现在被凭空造出来了（已删除）',
      );
    }
    if (d.status === 'deleted') {
      lines.push(
        d.tier === 'committed'
          ? '     - 提交基线里有，磁盘上被删了（git 里会表现为一次删除）'
          : '     - 快照时存在，现在被删掉了（已写回原内容）',
      );
    }
    if (d.parseNote) lines.push(`     - ${d.parseNote}：按整份内容不同处理`);
    for (const k of d.keys || []) {
      lines.push(`     - ${k.key}: ${k.before} → ${k.after}`);
    }
    if (d.status === 'changed' && !d.parseNote && (!d.keys || d.keys.length === 0)) {
      lines.push('     - 顶层 key 无变化，仅排版/空白不同');
    }
  });
  if (hasRun) {
    lines.push('  运行窗口内的改动已按快照还原；若这是开发者工具回写，请把本消息当作该轮出码包内容不可信的凭据。');
  }
  if (hasCommitted) {
    lines.push(
      '  ⚠️ 提交基线差异**未自动还原**（磁盘上可能是有意改的，写回会毁掉它）。两条出路，必须选一条：',
      '     ① 不是有意的（开发者工具回写）→ `git diff <上面的文件>` 看一眼后 `git checkout -- <上面的文件>`；',
      '     ② 是有意的 → 提交它。别把它当「无关的格式变更」一起提交 —— 这份文件决定哪些文件进上传包。',
    );
  }
  return lines.join('\n');
}

/**
 * 守卫入口：先快照，之后随时 verify()。
 * verify() 两层都查：
 *   ① 运行窗口有差异 → **先还原**（安全：这一定是本次运行造成的）；
 *   ② 再与提交基线比 → 有任何差异、或 ①有差异，都返回 { ok: false, message }（调用方负责让它红）。
 * ② 只报红不还原 —— 见 diffAgainstCommitted 的注释。
 * @param {string[]} [appRoots]
 * @returns {{ snapshot: object[], verify: () => { ok: boolean, message: string, diffs: object[] } }}
 */
function guardProjectConfigs(appRoots = PROJECT_CONFIG_APPS) {
  const snapshot = snapshotProjectConfigs(appRoots);
  return {
    snapshot,
    verify() {
      const diffs = diffProjectConfigs(snapshot);
      if (diffs.length > 0) {
        restoreProjectConfigs(snapshot); // 先还原：失败也不能留下被改过的包配置
      }
      // 还原之后再比提交基线：①里的改动如果还原回了基线，就不该在②里再报一遍
      const committedDiffs = diffAgainstCommitted(appRoots);
      const all = diffs.concat(committedDiffs);
      if (all.length === 0) return { ok: true, message: '', diffs: [] };
      return { ok: false, message: formatDiffMessage(all), diffs: all };
    },
  };
}

module.exports = {
  CLI_PATH,
  LAUNCH_TIMEOUT_MS,
  PROJECT_CONFIG_NAME,
  PROJECT_CONFIG_APPS,
  snapshotProjectConfigs,
  diffProjectConfigs,
  readCommittedProjectConfig,
  diffAgainstCommitted,
  restoreProjectConfigs,
  formatDiffMessage,
  guardProjectConfigs,

  /**
   * 测试前启动工具。
   *
   * ⚠️ 失败**不抛异常**，而是 resolve(null)：
   *   开发者工具没装 / 没开自动化端口 / 首次编译报错，都是**环境问题**而非代码问题。
   *   抛出去会让整套用例红掉，把环境噪声混进 CI 信号里。
   *   调用方（draw.test.js）拿到 null 后应整体 skip。
   */
  async setup() {
    try {
      return await automator.launch({
        cliPath: CLI_PATH,
        projectPath: process.cwd(),
        timeout: LAUNCH_TIMEOUT_MS,
      });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      console.warn(
        `[setup] 微信开发者工具启动失败，本套 E2E 将跳过：${msg}\n` +
          `         检查：① 开发者工具是否已安装（${CLI_PATH}）` +
          ` ② 设置 → 安全设置 → 服务端口是否开启`,
      );
      return null;
    }
  },

  // 测试后关闭
  async teardown(miniProgram) {
    if (miniProgram) {
      try {
        await miniProgram.close();
      } catch {
        /* 关闭失败无需阻塞测试收尾 */
      }
    }
  },
};
