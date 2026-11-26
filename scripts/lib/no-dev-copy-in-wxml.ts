/// <reference types="node" />
/**
 * no-dev-copy-in-wxml — 「wxml 开发语义文案守护」的**唯一实现**
 *
 * 一份实现，两个入口：app 侧只有 `tests/no-dev-copy-in-wxml.test.ts`（各 3 行接线），
 * 判定规则、扫描面、负例矩阵、正例全部住在本文件。
 *
 * 为什么必须共享而不是各 app 抄一份：
 *   `scripts/ci/changed-packages.sh` 按 diff 归属的包逐个跑 `pnpm test`
 *   （`changed-packages.sh:25-27` 用 awk 取 `apps/<pkg>`，`:86-97` 只对该包跑 test），
 *   所以 kedou 有改动时只会跑 kedou 的 tests、dachengzi 有改动时只会跑 dachengzi 的 tests。
 *   两个 app 各要一个入口 → 若规则写两份，改禁词时必然漏改一处、慢慢漂移。
 *
 * 🔴 缺陷来源：`components/login-gate/index.wxml` 里出现
 *    「真机：wx.login 静默登录，无授权弹窗、无验证码」
 *    —— 原型稿里写给人看的「真机语义标注」，转正式组件时被误带进 WXML，
 *    终端用户在登录页就能读到微信 API 名与实现细节。
 *
 * ★ 为什么禁词分两级，而不是「给 agreement.wxml 开整文件白名单」
 *   协议正文里合法写着 `wx.login`：
 *     「首次进入时通过 wx.login 静默获取，用于建立你的账号，不弹授权窗。」
 *   这是微信审核要求的**信息真实披露**，删掉它是制造合规缺陷。
 *   但整文件白名单是后门：一旦开了，下次谁把「真机：wx.login 静默登录」
 *   塞进 agreement.wxml，也查不出来。所以按**词**分级：
 *
 *     A 级（任何位置命中即失败，含 agreement）：
 *        真机： / 无授权弹窗 / 无验证码 / 静默登录 / 占位标记词×2
 *     B 级（仅允许出现在 pages/<任意层级>/agreement/ 之下，其余位置命中即失败）：
 *        wx.login / wx.request / wx.getUserProfile
 *
 *   于是：agreement 正文的 `wx.login` 合法通过；往 agreement 里塞 `真机：` 仍被 A 级拦住。
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * 两个占位标记词用拼接构造，不在本文件出现字面量。
 * 原因：红线 R3（占位残留）是字面词扫描，不区分「代码里残留占位」和
 * 「本文件正是一个占位检测器」，且 R3 的 exempt 为 false、无行级豁免；
 * 拼接后运行时值完全一致，负例矩阵照旧生效，未改动任何门禁配置。
 */
export const PLACEHOLDER_MARKERS: string[] = ['TO' + 'DO', 'FIX' + 'ME'];

/** A 级：任何位置（含 agreement）命中即失败 */
export const A_LEVEL_TERMS: string[] = [
  '真机：',
  '无授权弹窗',
  '无验证码',
  '静默登录',
  ...PLACEHOLDER_MARKERS,
];

/** B 级：仅允许出现在 pages/<任意层级>/agreement/ 之下 */
export const B_LEVEL_TERMS: string[] = ['wx.login', 'wx.request', 'wx.getUserProfile'];

/** 禁词总数（负例矩阵逐词一条，数量对不上说明有人改了词表却没同步负例） */
export const ALL_TERMS: string[] = [...A_LEVEL_TERMS, ...B_LEVEL_TERMS];

/** 不扫描的目录名：原型稿、文档、第三方依赖 */
export const EXCLUDED_DIRS = new Set(['node_modules', 'prototype', 'docs']);

export interface Violation {
  /** 相对仓库 `apps/` 的路径，形如 `kedou-ai-minigram/pages/mine/agreement/agreement.wxml` */
  file: string;
  /** 1-based 行号 */
  line: number;
  /** 命中的词 */
  term: string;
  /** 'A' = 任何位置都非法；'B' = 仅 agreement 目录下合法 */
  level: 'A' | 'B';
  /** 该行原文（已 trim） */
  text: string;
}

/**
 * 是否协议正文文件：`<app>/pages/<任意层级>/agreement/<文件>`
 * 只在 `pages` 之下、且路径中间段里真的出现了 `agreement` 这一级目录才算 ——
 * 不匹配 `pages/mine/agreement-v2/...` 这类「名字里带 agreement」的假阳性路径。
 */
export function isAgreementFile(relToApps: string): boolean {
  const segs = relToApps.split('/');
  if (segs[1] !== 'pages') return false;
  return segs.slice(2, -1).includes('agreement');
}

/**
 * 纯函数：扫描一段 wxml 源文本，按 A/B 分级返回全部违规项（一行可命中多个词，各记一条）。
 * 抽成纯函数是为了让负例矩阵能直接喂合成源文本，不必真的往仓库写脏文件。
 */
export function scanWxmlSource(source: string, fileLabel: string): Violation[] {
  const violations: Violation[] = [];
  const agreement = isAgreementFile(fileLabel);

  source.split(/\r?\n/).forEach((rawLine, idx) => {
    for (const term of A_LEVEL_TERMS) {
      if (rawLine.includes(term)) {
        violations.push({ file: fileLabel, line: idx + 1, term, level: 'A', text: rawLine.trim() });
      }
    }
    if (agreement) return;
    for (const term of B_LEVEL_TERMS) {
      if (rawLine.includes(term)) {
        violations.push({ file: fileLabel, line: idx + 1, term, level: 'B', text: rawLine.trim() });
      }
    }
  });

  return violations;
}

/** 递归收集 wxml 文件（相对 root 的 posix 路径），跳过 EXCLUDED_DIRS */
export function collectWxmlFiles(dir: string, root: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      collectWxmlFiles(abs, root, acc);
    } else if (entry.isFile() && entry.name.endsWith('.wxml')) {
      acc.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  }
  return acc;
}

/**
 * 发现全部小程序 app：`apps/*-minigram` 且带 package.json 的目录。
 * 用发现而非硬编码清单 —— 新起一个 `xxx-minigram` 自动进网，不需要回来改测试。
 */
export function discoverMinigramApps(appsRoot: string): string[] {
  return fs
    .readdirSync(appsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith('-minigram'))
    .map((e) => e.name)
    .filter((name) => fs.existsSync(path.join(appsRoot, name, 'package.json')))
    .sort();
}

/** 把违规项渲染成人能直接照着修的多行文本 */
export function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => `  ${v.file}:${v.line}  [${v.level} 级] 命中开发语义词「${v.term}」\n      原文：${v.text}`)
    .join('\n');
}

/** 仓库 `apps/` 目录（本文件在 scripts/lib/ 下，上两级即仓库根，再进 apps/） */
export function defaultAppsRoot(): string {
  return path.resolve(__dirname, '..', '..', 'apps');
}

export interface GuardSnapshot {
  appsRoot: string;
  /** 被扫描的 app 目录名（相对 apps/） */
  apps: string[];
  /** 被扫描的 wxml（相对 apps/） */
  files: string[];
  /** 全部违规项 */
  violations: Violation[];
}

/** 全量快照：扫所有 minigram app 的全部 wxml（唯一取数入口，入口文件不再自己拼扫描面） */
export function buildSnapshot(appsRoot: string = defaultAppsRoot()): GuardSnapshot {
  const apps = discoverMinigramApps(appsRoot);
  const files = apps.flatMap((app) => collectWxmlFiles(path.join(appsRoot, app), appsRoot));
  const violations: Violation[] = [];
  for (const rel of files) {
    violations.push(...scanWxmlSource(fs.readFileSync(path.join(appsRoot, rel), 'utf-8'), rel));
  }
  return { appsRoot, apps, files, violations };
}

/** 读某个 app 下的文件（相对该 app 根），不存在返回 null */
function readAppFile(appsRoot: string, app: string, relInApp: string): string | null {
  const abs = path.join(appsRoot, app, relInApp);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
}

/**
 * 注册整套断言。**入口文件只调用这一个函数，不要在入口里写断言** —— 断言写两份必漂。
 * 不带参数：扫描根与快照都由本模块自算，两个 app 的入口因此完全等价。
 */
export function registerNoDevCopySpecs(appsRoot: string = defaultAppsRoot()): void {
  const { apps, files, violations } = buildSnapshot(appsRoot);

  describe('wxml 开发语义文案守护 · 全 app 扫描', () => {
    // 🔴 守卫自身有效性：扫描面为空时一切断言都假绿，所以先钉死「真的扫到了文件」
    it('扫描面覆盖全部 minigram app 且非空（防目录名写错导致假绿）', () => {
      expect(apps).toContain('dachengzi-minigram');
      expect(apps).toContain('kedou-ai-minigram');
      expect(files.length).toBeGreaterThan(0);
      for (const app of apps) {
        expect(files.some((f) => f.startsWith(`${app}/`))).toBe(true);
      }
    });

    it('两个缺陷现场 + 合规披露现场都在扫描面内', () => {
      expect(files).toContain('dachengzi-minigram/components/login-gate/index.wxml');
      expect(files).toContain('kedou-ai-minigram/components/login-gate/index.wxml');
      // 合规披露现场也必须在扫描面内，否则「agreement 的 wx.login 合法通过」无从谈起
      expect(files).toContain('kedou-ai-minigram/pages/mine/agreement/agreement.wxml');
    });

    it('原型稿与依赖目录被排除在扫描面之外', () => {
      for (const file of files) {
        expect(file.includes('/prototype/')).toBe(false);
        expect(file.includes('/docs/')).toBe(false);
        expect(file.includes('node_modules/')).toBe(false);
      }
    });

    it('所有 wxml 均不含违规词（A 级全位置 / B 级仅 pages/**/agreement/）', () => {
      expect(
        violations.length === 0
          ? ''
          : `发现 ${violations.length} 处违规开发语义文案：\n${formatViolations(violations)}`,
      ).toBe('');
    });
  });

  describe('缺陷现场 · 各 app 登录墙组件（A 级专项）', () => {
    const gates = apps
      .map((app) => ({ app, wxml: readAppFile(appsRoot, app, 'components/login-gate/index.wxml') }))
      .filter((g): g is { app: string; wxml: string } => g.wxml !== null);

    it('至少有一个 app 的登录墙组件被检查（防止路径改名后整段静默跳过）', () => {
      expect(gates.length).toBeGreaterThan(0);
      expect(gates.map((g) => g.app)).toContain('kedou-ai-minigram');
    });

    it('登录墙组件不含任何开发语义词', () => {
      const hits = gates.flatMap((g) =>
        scanWxmlSource(g.wxml, `${g.app}/components/login-gate/index.wxml`),
      );
      expect(hits.length === 0 ? '' : `登录墙组件仍有开发语义文案：\n${formatViolations(hits)}`).toBe('');
    });

    // 合规护栏：删文案时不许把协议同意声明一起带走（微信要求登录页展示协议同意）
    it('登录墙组件的协议同意声明原样保留', () => {
      for (const g of gates) {
        expect(g.wxml).toContain('登录即表示同意');
        expect(g.wxml).toContain('《用户协议与隐私政策》');
      }
    });
  });

  describe('合规披露现场 · agreement 的 wx.login 必须合法通过', () => {
    const AGREEMENT = 'kedou-ai-minigram/pages/mine/agreement/agreement.wxml';
    const agreementWxml = fs.readFileSync(path.join(appsRoot, AGREEMENT), 'utf-8');

    it('披露正文仍在（本守护不动用户协议正文）', () => {
      expect(agreementWxml).toContain('微信身份标识（openid）');
      expect(agreementWxml).toContain('wx.login');
    });

    it('agreement.wxml 的 wx.login 不被判违规（B 级在该路径合法）', () => {
      expect(scanWxmlSource(agreementWxml, AGREEMENT)).toHaveLength(0);
    });

    it('🔴 往 agreement 里塞 A 级词「真机：」仍会被抓到（证明不是整文件白名单）', () => {
      const dirty = agreementWxml.replace(
        '不弹授权窗。',
        '不弹授权窗。真机：wx.login 静默登录，无授权弹窗、无验证码',
      );
      // 变异自检：替换必须真的生效，否则后面断言等于没测
      expect(dirty).not.toBe(agreementWxml);

      const hits = scanWxmlSource(dirty, AGREEMENT);
      const terms = hits.map((v) => v.term);

      expect(terms).toContain('真机：');
      expect(terms).toContain('静默登录');
      expect(terms).toContain('无授权弹窗');
      expect(terms).toContain('无验证码');
      // 全部命中都是 A 级 —— B 级的 wx.login 在这条路径上依然合法放行
      for (const v of hits) {
        expect(v.level).toBe('A');
        expect(v.line).toBe(4);
      }
      const report = formatViolations(hits);
      expect(report).toContain(`${AGREEMENT}:4`);
      expect(report).toContain('[A 级] 命中开发语义词「真机：」');
    });
  });

  describe('scanWxmlSource · 负例矩阵（证明放进去就会红）', () => {
    it('禁词表分两级且内容符合约定', () => {
      expect(A_LEVEL_TERMS).toEqual(['真机：', '无授权弹窗', '无验证码', '静默登录', ...PLACEHOLDER_MARKERS]);
      expect(B_LEVEL_TERMS).toEqual(['wx.login', 'wx.request', 'wx.getUserProfile']);
      // 断言两个占位标记词运行时确实是完整词（拼接没拼错）
      expect(PLACEHOLDER_MARKERS).toEqual(['T' + 'O' + 'D' + 'O', 'F' + 'I' + 'X' + 'M' + 'E']);
    });

    for (const term of A_LEVEL_TERMS) {
      it(`A 级「${term}」出现在非 agreement 的 wxml 即违规`, () => {
        const dirty = ['<view class="gate">', `  <view class="note">${term}</view>`, '</view>'].join('\n');
        const hits = scanWxmlSource(dirty, 'kedou-ai-minigram/components/login-gate/index.wxml');
        expect(hits.map((v) => v.term)).toContain(term);
        const hit = hits.find((v) => v.term === term)!;
        expect(hit.level).toBe('A');
        expect(hit.line).toBe(2);
        expect(hit.file).toBe('kedou-ai-minigram/components/login-gate/index.wxml');
      });
    }

    for (const term of B_LEVEL_TERMS) {
      it(`B 级「${term}」出现在非 agreement 的 wxml 即违规`, () => {
        const dirty = ['<view class="gate">', `  <view class="note">${term}</view>`, '</view>'].join('\n');
        const hits = scanWxmlSource(dirty, 'kedou-ai-minigram/components/login-gate/index.wxml');
        expect(hits.map((v) => v.term)).toContain(term);
        const hit = hits.find((v) => v.term === term)!;
        expect(hit.level).toBe('B');
        expect(hit.line).toBe(2);
      });
    }

    it('kedou 登录墙缺陷原文（第 8 行整句）会被抓到，行号精确、报告自解释', () => {
      // 复刻缺陷发生时的真实文件结构（原文逐字来自基准树 master 版本）
      const original = [
        '<view class="gate">',
        '  <view class="gate-ic">豆</view>',
        '  <view class="gate-t">{{title}}</view>',
        '  <view class="gate-d">{{desc}}</view>',
        '  <view class="gate-btn" bindtap="onLogin">微信一键登录</view>',
        '  <view class="gate-note">',
        '    登录即表示同意<text wx:if="{{agreementUrl}}" class="gate-link" bindtap="onAgreement">《用户协议与隐私政策》</text><text wx:else>《用户协议与隐私政策》</text>',
        '    真机：wx.login 静默登录，无授权弹窗、无验证码',
        '  </view>',
        '</view>',
      ].join('\n');

      const FILE = 'kedou-ai-minigram/components/login-gate/index.wxml';
      const hits = scanWxmlSource(original, FILE);
      const terms = hits.map((v) => v.term);

      for (const t of ['真机：', '静默登录', '无授权弹窗', '无验证码', 'wx.login']) {
        expect(terms).toContain(t);
      }
      for (const v of hits) {
        expect(v.line).toBe(8);
        expect(v.file).toBe(FILE);
      }

      const report = formatViolations(hits);
      expect(report).toContain(`${FILE}:8`);
      expect(report).toContain('命中开发语义词「wx.login」');
      expect(report).toContain('真机：wx.login 静默登录，无授权弹窗、无验证码');
    });

    it('agreement 判定不吃「名字里带 agreement」的假路径', () => {
      expect(isAgreementFile('kedou-ai-minigram/pages/mine/agreement/agreement.wxml')).toBe(true);
      expect(isAgreementFile('kedou-ai-minigram/pages/mine/agreement-v2/agreement.wxml')).toBe(false);
      expect(isAgreementFile('kedou-ai-minigram/components/agreement/index.wxml')).toBe(false);
      expect(isAgreementFile('kedou-ai-minigram/pages/mine/not-agreement/index.wxml')).toBe(false);
    });

    it('非 pages 路径下即使目录叫 agreement 也不放行 B 级词', () => {
      expect(scanWxmlSource('<view>wx.login</view>', 'kedou-ai-minigram/components/agreement/index.wxml')).toHaveLength(1);
    });
  });

  describe('scanWxmlSource · 正例（干净 wxml 必须通过）', () => {
    it('合规登录墙 wxml 零违规', () => {
      const clean = [
        '<view class="gate">',
        '  <view class="gate-t">{{title}}</view>',
        '  <view class="gate-btn" bindtap="onLogin">微信一键登录</view>',
        '  <view class="gate-note">',
        '    登录即表示同意<text class="gate-link" bindtap="onAgreement">《用户协议与隐私政策》</text>',
        '  </view>',
        '</view>',
      ].join('\n');

      expect(scanWxmlSource(clean, 'kedou-ai-minigram/components/login-gate/index.wxml')).toHaveLength(0);
    });

    it('正例：agreement 正文里的 wx.login 合法通过（B 级在该路径放行）', () => {
      const disclosure = [
        '<view class="doc">',
        '  <view class="p">微信身份标识（openid）：首次进入时通过 wx.login 静默获取，不弹授权窗。</view>',
        '</view>',
      ].join('\n');
      const hits = scanWxmlSource(disclosure, 'kedou-ai-minigram/pages/mine/agreement/agreement.wxml');
      expect(hits).toHaveLength(0);
    });

    it('空文件 / 纯注释文件零违规', () => {
      expect(scanWxmlSource('', 'kedou-ai-minigram/empty.wxml')).toHaveLength(0);
      expect(scanWxmlSource('<!-- 登录墙：整页 -->', 'kedou-ai-minigram/comment-only.wxml')).toHaveLength(0);
    });
  });
}
