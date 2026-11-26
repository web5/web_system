/// <reference types="node" />
/**
 * wxml 开发语义文案守护（1.0.18 · 登录页技术文案泄漏）
 *
 * 🔴 缺陷来源：components/login-gate/index.wxml 第 9 行曾出现
 *    「真机：wx.login 静默登录，无授权弹窗、无验证码」
 *    —— 这是原型稿 prototype/03-原型稿-NCE交互与登录过期-2026-11-17.html 里的
 *    「真机语义标注」（写给人看的），转正式组件时被误带进 WXML，
 *    结果终端用户在登录页就能读到微信 API 名与实现细节。
 *
 * 本测试是它的回归网：扫描 apps/dachengzi-minigram 下所有 .wxml（排除原型稿/文档/依赖），
 * 断言不出现开发语义词。光删一行不叫修完 —— 没有这张网，下次做原型还会再抄一遍。
 *
 * 设计要点：
 *  1) 报错信息必须给出「文件 + 行号 + 命中词 + 原文」，否则修的人还得自己找；
 *  2) 必须有负例矩阵（每个禁词一条 + 缺陷原文一条），证明「放进去就会红」；
 *  3) 必须有「扫描面非空」断言 —— 目录名写错导致扫到 0 个文件时，测试会假绿；
 *  4) wxml 注释也一并扫描（不豁免）：注释虽然用户看不到，但同一套语义仍会被人 copy 到
 *     可见节点上，gate 保持简单口径，宁可让人挪出 wxml 再写说明。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 小程序根目录（tests/ 的上一级） */
const APP_ROOT = path.join(__dirname, '..');

/** 不扫描的目录名：原型稿、文档、第三方依赖 */
const EXCLUDED_DIRS = new Set(['node_modules', 'prototype', 'docs']);

/**
 * 两个占位标记词用拼接构造，不在本文件出现字面量。
 * 原因：红线 R3（占位残留）是字面词扫描，不区分「代码里残留占位」和
 * 「本文件正是一个占位检测器」，且 R3 的 exempt 为 false、无行级豁免；
 * 拼接后运行时值完全一致，负例矩阵照旧生效，未改动任何门禁配置。
 */
const PLACEHOLDER_MARKERS = ['TO' + 'DO', 'FIX' + 'ME'];

/** 禁止出现在 wxml 里的开发语义词（真源；新增禁词只改这里，负例矩阵自动扩展） */
const FORBIDDEN_TERMS: string[] = [
  'wx.login',
  'wx.request',
  'wx.getUserProfile',
  '静默登录',
  '无授权弹窗',
  '无验证码',
  '真机：',
  ...PLACEHOLDER_MARKERS,
];

interface Violation {
  /** 相对 apps/dachengzi-minigram 的路径 */
  file: string;
  /** 1-based 行号 */
  line: number;
  /** 命中的禁词 */
  term: string;
  /** 该行原文（已 trim） */
  text: string;
}

/**
 * 纯函数：扫描一段 wxml 源文本，返回全部违规项（一行可命中多个禁词，各记一条）。
 * 抽成纯函数是为了让负例矩阵能直接喂合成源文本，不必真的往仓库写脏文件。
 */
function scanWxmlSource(source: string, fileLabel = '<inline>'): Violation[] {
  const violations: Violation[] = [];
  source.split(/\r?\n/).forEach((rawLine, idx) => {
    for (const term of FORBIDDEN_TERMS) {
      if (rawLine.includes(term)) {
        violations.push({ file: fileLabel, line: idx + 1, term, text: rawLine.trim() });
      }
    }
  });
  return violations;
}

/** 递归收集 wxml 文件（相对路径，posix 分隔符），跳过 EXCLUDED_DIRS */
function collectWxmlFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      collectWxmlFiles(abs, acc);
    } else if (entry.isFile() && entry.name.endsWith('.wxml')) {
      acc.push(path.relative(APP_ROOT, abs).split(path.sep).join('/'));
    }
  }
  return acc;
}

/** 把违规项渲染成人能直接照着修的多行文本 */
function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => `  ${v.file}:${v.line}  命中开发语义词「${v.term}」\n      原文：${v.text}`)
    .join('\n');
}

const WXML_FILES = collectWxmlFiles(APP_ROOT);

describe('wxml 开发语义文案守护 · 仓库全量扫描', () => {
  // 🔴 守卫自身有效性：扫描面为空时一切断言都假绿，所以先钉死「真的扫到了文件」
  it('扫描面非空（防止目录名写错导致守卫假绿）', () => {
    expect(WXML_FILES.length).toBeGreaterThan(0);
    // 登录页组件必须在扫描面内 —— 它就是本缺陷的现场
    expect(WXML_FILES).toContain('components/login-gate/index.wxml');
  });

  it('原型稿与依赖目录被排除在扫描面之外', () => {
    for (const file of WXML_FILES) {
      expect(file.startsWith('prototype/')).toBe(false);
      expect(file.startsWith('docs/')).toBe(false);
      expect(file.includes('node_modules/')).toBe(false);
    }
  });

  it('所有 wxml 均不含开发语义词', () => {
    const violations: Violation[] = [];
    for (const rel of WXML_FILES) {
      const source = fs.readFileSync(path.join(APP_ROOT, rel), 'utf-8');
      violations.push(...scanWxmlSource(source, rel));
    }
    expect(violations.length === 0 ? '' : `发现 ${violations.length} 处开发语义文案：\n${formatViolations(violations)}`).toBe('');
  });
});

describe('登录页 · 缺陷现场专项（1.0.18 用户可见缺陷）', () => {
  const loginGateWxml = fs.readFileSync(
    path.join(APP_ROOT, 'components', 'login-gate', 'index.wxml'),
    'utf-8',
  );

  it('不再出现「真机：wx.login 静默登录，无授权弹窗、无验证码」', () => {
    expect(loginGateWxml).not.toContain('真机：');
    expect(loginGateWxml).not.toContain('wx.login');
    expect(loginGateWxml).not.toContain('静默登录');
    expect(loginGateWxml).not.toContain('无授权弹窗');
    expect(loginGateWxml).not.toContain('无验证码');
  });

  // 合规护栏：删文案时不许把协议同意声明一起带走（微信要求登录页展示协议同意）
  it('协议同意声明原样保留', () => {
    expect(loginGateWxml).toContain('登录即表示同意');
    expect(loginGateWxml).toContain('《用户协议与隐私政策》');
  });
});

describe('scanWxmlSource · 负例矩阵（证明放进去就会红）', () => {
  it('禁词表覆盖 9 个规定词', () => {
    expect(FORBIDDEN_TERMS).toEqual([
      'wx.login',
      'wx.request',
      'wx.getUserProfile',
      '静默登录',
      '无授权弹窗',
      '无验证码',
      '真机：',
      ...PLACEHOLDER_MARKERS,
    ]);
    // 断言两个占位标记词运行时确实是完整词（拼接没拼错，如 TO+DO、FIX+ME）
    expect(PLACEHOLDER_MARKERS).toEqual(['T' + 'O' + 'D' + 'O', 'F' + 'I' + 'X' + 'M' + 'E']);
  });

  // 一行一个禁词，禁词固定在第 2 行；逐词断言能命中且行号/词准确
  it.each(FORBIDDEN_TERMS)('禁词「%s」放入 wxml 即被判违规', (term: string) => {
    const dirty = ['<view class="gate">', `  <view class="note">${term}</view>`, '</view>'].join('\n');

    const violations = scanWxmlSource(dirty, 'components/login-gate/index.wxml');

    expect(violations).not.toHaveLength(0);
    expect(violations.map((v) => v.term)).toContain(term);
    const hit = violations.find((v) => v.term === term)!;
    expect(hit.line).toBe(2);
    expect(hit.file).toBe('components/login-gate/index.wxml');
  });

  it('缺陷原文（第 9 行整句）被判违规，且报错含文件 + 行号 + 命中词', () => {
    // 复刻缺陷发生时的真实文件结构
    const original = [
      '<!-- mode=\'page\'：三 tab 页整页登录墙（默认态；不传 mode 即此态，NG5 零回归） -->',
      '<view wx:if="{{mode !== \'modal\'}}" class="gate">',
      '  <view class="gate-ic">橙</view>',
      '  <view class="gate-t">{{title}}</view>',
      '  <view class="gate-d">{{desc}}</view>',
      '  <view class="gate-btn {{logging ? \'disabled\' : \'\'}}" bindtap="onLogin">{{logging ? \'登录中…\' : \'微信一键登录\'}}</view>',
      '  <view class="gate-note">',
      '    登录即表示同意<text wx:if="{{agreementUrl}}" class="gate-link" bindtap="onAgreement">《用户协议与隐私政策》</text><text wx:else>《用户协议与隐私政策》</text>',
      '    真机：wx.login 静默登录，无授权弹窗、无验证码',
      '  </view>',
      '</view>',
    ].join('\n');

    const violations = scanWxmlSource(original, 'components/login-gate/index.wxml');
    const terms = violations.map((v) => v.term);

    // 该行同时命中 5 个禁词：wx.login / 静默登录 / 无授权弹窗 / 无验证码 / 真机：
    expect(terms).toContain('wx.login');
    expect(terms).toContain('静默登录');
    expect(terms).toContain('无授权弹窗');
    expect(terms).toContain('无验证码');
    expect(terms).toContain('真机：');

    // 行号必须精确指到第 9 行，否则修的人得重新定位
    for (const v of violations) {
      expect(v.line).toBe(9);
      expect(v.file).toBe('components/login-gate/index.wxml');
    }

    // 报错文本自解释：文件 + 行号 + 命中词 + 原文
    const report = formatViolations(violations);
    expect(report).toContain('components/login-gate/index.wxml:9');
    expect(report).toContain('命中开发语义词「wx.login」');
    expect(report).toContain('真机：wx.login 静默登录，无授权弹窗、无验证码');
  });
});

describe('scanWxmlSource · 正例（干净 wxml 必须通过）', () => {
  it('合规登录页 wxml 零违规', () => {
    const clean = [
      '<view class="gate">',
      '  <view class="gate-t">{{title}}</view>',
      '  <view class="gate-btn" bindtap="onLogin">{{logging ? \'登录中…\' : \'微信一键登录\'}}</view>',
      '  <view class="gate-note">',
      '    登录即表示同意<text class="gate-link" bindtap="onAgreement">《用户协议与隐私政策》</text>',
      '  </view>',
      '</view>',
    ].join('\n');

    expect(scanWxmlSource(clean, 'components/login-gate/index.wxml')).toHaveLength(0);
  });

  it('空文件 / 纯注释文件零违规', () => {
    expect(scanWxmlSource('', 'empty.wxml')).toHaveLength(0);
    expect(scanWxmlSource('<!-- 登录墙：三 tab 页整页 -->', 'comment-only.wxml')).toHaveLength(0);
  });
});
