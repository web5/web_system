/// <reference types="node" />
/**
 * 静态守卫 —— 任何测试文件都不许删除**真实的**产物目录
 *
 * 由来（P1 事故）：2026-11-26 22:07–22:08 与 22:16:22，用户刚出的预览码
 * （cli-preview-qr.png + cli-preview-qr.meta.json）两次凭空消失。
 *
 * 机制：tests/preflight.test.ts 的一条用例在 finally 里**无条件**删掉了仓库里真实的
 * .ci-output/ —— 它以为那是自己刚 mkdir 出来的空目录，实际那是用户的产物目录。
 * 紧随其后的用例又执行 mkdir 把目录重建为空，于是现场只剩
 * 「目录在、内容空、mtime 是那一刻、父目录 mtime 也被改」，极难反查。
 *
 * 那一处已单独修好（改成带 ciOutExisted 前置条件）。**本文件的职责是堵住第二处**：
 * 只要有人再写出同类代码，本守卫立刻变红，并直接告出「文件:行号 + 该行原文」。
 *
 * 🔴 为什么不是写几条期望匹配就完事：
 *    静态守卫最常见的死法是「空转」——扫描列表为空、正则写错、永远匹配不到，测试恒绿。
 *    故本文件做了三重防空转：
 *      1) 先断言真的扫到了足够多的文件（> 20），且其中确实包含那条事故文件；
 *      2) 先断言「被扫范围内确实存在产物目录这个名字」，证明本守卫的**作用域非空**；
 *      3) 用一个纯函数做检测核心，并**反过来喂给它事故原写法**，断言它真的能抓红
 *         （含「变量间接引用」型），再喂给它合法写法断言不误报。
 *
 * 🔴 豁免为什么只给一行、且必须精确到行：
 *    修好后的清理行确实是「对产物目录做删除」，但它是**受前置条件保护**的。
 *    豁免判据 = 该行本身同时含 ciOutExisted 前置条件（且限定在 preflight.test.ts），
 *    而不是整文件豁免 —— 整文件豁免等于给事故文件开后门，本守卫就废了。
 *    豁免条数还被钉成一个确切数字：新增豁免必须显式改这个数字，强制过一次复审。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 被扫根目录 = 本文件所在目录（tests/），不 hardcode 任何文件名清单。 */
const TESTS_DIR = __dirname;

/**
 * 产物目录名，**故意拼出来**。
 * 本文件自己也在 tests/ 下、也会被自己扫到 —— 源码里只要出现完整字面量，
 * 下面的正则/断言行就会自我误报。拼接后源码文本里不含完整名字，运行时值仍是原名。
 */
const ARTIFACT_DIR_NAME = '.' + 'ci-' + 'output';

/** 产物目录名在正则里的写法（转义点号），同样拼出来避免自报。 */
const ARTIFACT_DIR_RE_BODY = '\\.' + 'ci-' + 'output';

/**
 * 「声明了一个指向产物目录的变量」的识别式。
 * 用于抓住变量间接引用型：
 *   const ciOut = path.join(__dirname, '..', <产物目录名>);
 *   fs.rm<Sync>(ciOut, { recursive: true });   ← 这一行本身不含字面量，只靠追踪变量才抓得到
 */
const ARTIFACT_VAR_RE = new RegExp(
  '(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*.*' + ARTIFACT_DIR_RE_BODY,
);

/** 破坏性删除操作的识别 token（字符串匹配，够用且不易写错）。 */
const DESTRUCTIVE_TOKENS = [
  'rmSync',
  'rmdirSync',
  'unlinkSync',
  'rm -rf',
  'rm -r',
  'fs.rm(',
];

interface Violation {
  /** 相对 tests/ 的路径 */
  file: string;
  /** 1-based 行号 */
  line: number;
  /** 该行原文（已 trim，便于直接定位） */
  text: string;
}

/**
 * 是否纯注释行。注释删不掉文件，故不参与检测 —— 否则「解释这条禁令」的文档本身会被判违规，
 * 逼着大家不敢写注释，这是本末倒置。注意：只跳过**纯注释行**，
 * 代码行后面跟的尾注释仍会被完整扫描（宁可严一点）。
 */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/');
}

/**
 * 检测核心（纯函数，便于用事故原写法反向验证）。
 *
 * 判据 = 同一行既出现破坏性操作，又「触碰」产物目录：
 *   - 该行含产物目录字面量，或
 *   - 该行引用了本文件内被识别为「产物目录变量」的标识符（整词匹配）
 */
function findViolations(file: string, source: string): Violation[] {
  const lines = source.split(/\r?\n/);

  // 第一遍：收集本文件里「指向产物目录」的变量名
  const artifactVars = new Set<string>();
  for (const line of lines) {
    if (isCommentLine(line)) continue;
    const m = ARTIFACT_VAR_RE.exec(line);
    if (m) artifactVars.add(m[1]);
  }
  const varRes = [...artifactVars].map((v) => new RegExp('\\b' + v + '\\b'));

  // 第二遍：逐行判定
  const out: Violation[] = [];
  lines.forEach((line, idx) => {
    if (isCommentLine(line)) return;
    if (!DESTRUCTIVE_TOKENS.some((tk) => line.includes(tk))) return;

    const touchesArtifactDir =
      line.includes(ARTIFACT_DIR_NAME) || varRes.some((re) => re.test(line));
    if (!touchesArtifactDir) return;

    out.push({ file, line: idx + 1, text: line.trim() });
  });
  return out;
}

/** 递归收集 dir 下所有 .ts 文件（自己读目录，不维护文件名清单）。 */
function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      // 不跟进 node_modules（本包 tests/ 下没有，但保持防御）
      if (ent.name === 'node_modules') continue;
      collectTsFiles(full, acc);
    } else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const toRel = (abs: string): string => path.relative(TESTS_DIR, abs).split(path.sep).join('/');

describe('静态守卫：测试文件不得删除真实的产物目录', () => {
  const absFiles = collectTsFiles(TESTS_DIR);

  it('扫描范围非空且足够大（防止「扫了个空目录 → 恒绿」式空转）', () => {
    // 本包 tests/ 实测 59 个 .ts；门槛取 20 是宽松但足以证明「真的在读目录」
    expect(absFiles.length).toBeGreaterThan(20);
    // 事故文件必须在扫描范围内，否则下面那条豁免断言毫无意义
    expect(absFiles.map(toRel)).toContain('preflight.test.ts');
  });

  it('被扫范围内确实存在产物目录这个概念（证明守卫作用域非空）', () => {
    const mentioning = absFiles.filter((f) => fs.readFileSync(f, 'utf8').includes(ARTIFACT_DIR_NAME));
    expect(mentioning.length).toBeGreaterThan(0);
    expect(mentioning.map(toRel)).toContain('preflight.test.ts');
  });

  it('没有任何测试文件对产物目录做破坏性删除（唯一豁免见下一条）', () => {
    const all: Violation[] = [];
    for (const abs of absFiles) {
      all.push(...findViolations(toRel(abs), fs.readFileSync(abs, 'utf8')));
    }

    // 唯一豁免：preflight.test.ts（tests/ 根下那一个文件）里**行内含 ciOutExisted 前置条件**的那一行清理。
    // 注意豁免判据是「文件精确相等 + 该行含前置条件」，不是整文件豁免 —— 整文件豁免等于给事故文件开后门。
    const exempted = all.filter(
      (v) => v.file === 'preflight.test.ts' && v.text.includes('ciOutExisted'),
    );
    const real = all.filter((v) => !exempted.includes(v));

    if (real.length > 0) {
      const dump = real.map((v) => `  ${v.file}:${v.line}\n    ${v.text}`).join('\n');
      throw new Error(
        `发现 ${real.length} 处「测试删除真实产物目录」的代码（会清掉用户刚出的预览码）：\n${dump}\n\n` +
          '修法：不要删仓库里的真实目录；用 os.tmpdir() 造临时目录，或加「进用例前是否存在」的前置条件。',
      );
    }
    expect(real).toHaveLength(0);

    // 豁免条数钉死：新增豁免必须显式改这个数字（强制过一次人眼复审），防止豁免慢慢烂成整文件豁免。
    // 当前唯一一条 = preflight.test.ts 里
    //   `if (!ciOutExisted) fs.rmSync(ciOut, { recursive: true, force: true });`
    // 它是「进用例前目录不存在才删」，属于受前置条件保护的清场，不是事故写法。
    if (exempted.length !== 1) {
      const dump = exempted.map((v) => `  ${v.file}:${v.line}\n    ${v.text}`).join('\n');
      throw new Error(
        `豁免条数期望 1，实际 ${exempted.length}。若确需新增/删除受保护清理行，请显式更新本断言。\n${dump}`,
      );
    }
    expect(exempted).toHaveLength(1);
  });
});

/**
 * 守卫自检 —— 反向验证检测核心真的会红。
 *
 * 🔴 这几条是「守卫不空转」的最终证据：如果哪天有人把 findViolations 改成恒返回 []，
 *    上面那条扫描用例仍然全绿，只有下面第一条会红。
 * 注意：所有合成源码都用字符串拼接构造，避免本文件被自己扫到时误报。
 */
describe('守卫自检（喂合成源码，验证检测核心不是空转）', () => {
  it('能抓住事故原写法：对产物目录字面量无条件 rm *Sync', () => {
    const buggyLine =
      '      fs.rm' + "Sync(path.join(__dirname, '..', '" + ARTIFACT_DIR_NAME +
      "'), { recursive: true, force: true });";
    const v = findViolations('preflight.test.ts', buggyLine);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
    expect(v[0].text).toContain('recursive');
  });

  it('能抓住变量间接引用型：先声明产物目录变量，再删该变量', () => {
    const src = [
      "const ciOut = path.join(__dirname, '..', '" + ARTIFACT_DIR_NAME + "');",
      'fs.rm' + 'Sync(ciOut, { recursive: true, force: true });',
    ].join('\n');
    const v = findViolations('some.test.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(2);
  });

  it('也能抓住 shell 里的 rm -rf 写法', () => {
    const src = [
      'const cmd = [',
      "  'rm -rf ' + " + "'" + ARTIFACT_DIR_NAME + "',",
      '].join(\'\');',
    ].join('\n');
    const v = findViolations('shell.test.ts', src);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(2);
  });

  it('不误报：删 os.tmpdir() 下的临时目录是合法写法', () => {
    const src = [
      "const tmp = fs.mkdtemp" + "Sync(path.join(os.tmpdir(), 'x-'));",
      'fs.rm' + 'Sync(tmp, { recursive: true, force: true });',
    ].join('\n');
    expect(findViolations('ok.test.ts', src)).toHaveLength(0);
  });

  it('纯注释行不算违规（注释删不掉文件），代码行带尾注释仍会被抓', () => {
    const commentOnly = '// 提醒：别对 ' + ARTIFACT_DIR_NAME + ' 调 fs.rm' + 'Sync';
    expect(findViolations('doc.test.ts', commentOnly)).toHaveLength(0);

    const codeWithComment =
      'fs.rm' + "Sync('" + ARTIFACT_DIR_NAME + "/x.png'); // 顺手清理";
    expect(findViolations('code.test.ts', codeWithComment)).toHaveLength(1);
  });
});
