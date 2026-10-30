/**
 * 公众号内联样式令牌（P0-B / REQ-3 S1）。
 * 色值来源：packages/ui/src/tokens.css light theme，全字面值展开（微信不认 CSS 变量）。
 * 字体栈：唯一偏离后台处——Geist 手机上没装，换微信通用栈。
 */

/* ── 色值令牌 ── */
export const C = {
  brand400: '#FB923C',
  brand500: '#F97316',
  brand600: '#EA580C',
  textPrimary: '#171717',
  textBody: '#3F3F46',
  textStrong: '#18181B',
  textSecondary: '#525252',
  bgHover: '#F2F2F2',
  borderSubtle: '#EBEBEB',
  codeBg: '#1C1E26',
  codeText: '#E2E8F0',
} as const;

/* ── 字体栈 ── */
export const FONT =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
export const MONO = "Menlo,Consolas,'Courier New',monospace";

/* ── 基准段落样式 ── */
export const BASE = `font-size:16px;line-height:1.8;color:${C.textBody};text-align:left;`;
export const BASE_LS = `${BASE}letter-spacing:0.2px;`;

/* ── 逐标签内联样式（对照表 1-17 项）── */
export const WS = {
  p: `margin:0 0 18px;${BASE_LS}`,
  h2: `margin:36px 0 14px;padding:0 0 0 12px;font-size:18px;font-weight:600;line-height:1.55;letter-spacing:0;color:${C.textPrimary};text-align:left;`,
  h2Bar: `<span style="display:inline-block;width:3px;height:16px;border-radius:2px;background:${C.brand500};margin:0 9px 0 -12px;vertical-align:middle;"></span>`,
  h3: `margin:26px 0 10px;font-size:16.5px;font-weight:600;line-height:1.6;letter-spacing:0;color:${C.textPrimary};text-align:left;`,
  h3Dot: `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${C.brand500};margin-right:8px;vertical-align:3px;"></span>`,
  h4: `margin:22px 0 8px;font-size:15px;font-weight:600;letter-spacing:0;color:${C.textSecondary};text-align:left;`,
  strong: `font-weight:600;color:${C.textStrong};`,
  em: `font-style:normal;font-weight:500;padding:1px 4px;border-radius:3px;background:rgba(249,115,22,0.14);`,
  a: `color:${C.brand600};text-decoration:none;border-bottom:1px solid rgba(249,115,22,0.35);`,
  codeSpan: `padding:2px 6px;font-family:${MONO};font-size:0.88em;color:${C.textSecondary};background:${C.bgHover};border-radius:4px;`,
  quote: `margin:22px 0;padding:14px 18px;background:${C.bgHover};border-left:3px solid ${C.brand500};border-radius:0 6px 6px 0;color:${C.textSecondary};${BASE_LS}`,
  img: `display:block;max-width:100%;height:auto;margin:22px auto;border-radius:6px;`,
  hr: `margin:30px 0;border:0;border-top:1px solid ${C.borderSubtle};`,
  li: `margin:0 0 10px;padding-left:20px;text-indent:-20px;${BASE_LS}`,
  dot: `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:${C.brand400};margin-right:15px;vertical-align:3px;"></span>`,
  codeWrap: `margin:20px 0;padding:16px 18px;background:${C.codeBg};border-radius:6px;overflow-x:auto;text-align:left;`,
  codeLine: `margin:0;padding:0;font-family:${MONO};font-size:13px;line-height:1.7;letter-spacing:0;color:${C.codeText};white-space:pre-wrap;word-break:break-word;text-align:left;`,
  /* 日报条目分隔（D2） */
  entrySection: `padding:20px 0;border-top:1px solid #EDEDED;`,
  /* 日报序号（D3） */
  entryNum: `color:${C.brand500};font-weight:700;min-width:22px;display:inline-block;`,
} as const;

/* ── 表格样式（第 16 项）── */
export const TABLE = {
  table: `width:100%;margin:22px 0;border-collapse:collapse;font-size:14px;`,
  th: `padding:10px 12px;text-align:left;border:1px solid ${C.borderSubtle};font-weight:600;color:${C.textPrimary};background:${C.bgHover};font-size:14px;line-height:1.7;`,
  td: `padding:10px 12px;text-align:left;border:1px solid ${C.borderSubtle};font-size:14px;line-height:1.7;color:${C.textBody};`,
} as const;
