/**
 * yaml-mini.ts — YAML 严格子集解析器（零依赖）
 *
 * 为什么自己写：仓库里没有 yaml 依赖，而 gates.yaml 只有 S2 引擎一个消费者。
 * 引入第三方依赖只为读一份自己维护的文件，不如把「支持的子集」写死并**显式报错**。
 *
 * 🔴 设计原则：宁可报错，不猜。
 *   不支持的构造（flow mapping / 锚点别名 / 多文档 / plain scalar 含 ": " ...）
 *   一律抛 YamlError 并带行号。静默猜错的配置比崩掉的配置危险得多 ——
 *   与 2026-10-30 修的门禁「假通过」是同一类问题。
 *
 * 支持的子集（够 gates.yaml 用，且都是无歧义写法）：
 *   key: value            普通映射
 *   key:                  嵌套块（下一行缩进更深）
 *   - item                序列（标量项）
 *   - key: value          序列里的映射项（后续键缩进 = 破折号缩进 + 2）
 *   key: |                块标量（保留换行）
 *   [a, b, c]             行内数组（仅标量，不支持嵌套）
 *   "..." / '...'         带引号字符串（plain scalar 无法表达 ":" 或 "#" 时用）
 *   true / false / null / 整数 / 小数
 */

export class YamlError extends Error {
  constructor(message: string, file: string, line: number) {
    super(`${file}:${line}: ${message}`);
    this.name = "YamlError";
  }
}

export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMap;
export interface YamlMap {
  [key: string]: YamlValue;
}

interface Line {
  indent: number;
  text: string;
  no: number;
}

interface State {
  lines: Line[];
  i: number;
  file: string;
}

const KEY_RE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ \t]|$)/;

function fail(state: State, no: number, msg: string): never {
  throw new YamlError(msg, state.file, no);
}

function tokenize(text: string, file: string): Line[] {
  const out: Line[] = [];
  const raw = text.split(/\r?\n/);
  for (let idx = 0; idx < raw.length; idx++) {
    const line = raw[idx];
    const no = idx + 1;
    if (line.trim() === "") continue;
    if (/^\s*#/.test(line)) continue;
    if (/^\s*\t/.test(line) || /^\t/.test(line)) {
      throw new YamlError("不允许用 Tab 缩进（YAML 规范禁止，且这里要求缩进必须肉眼可数）", file, no);
    }
    const indent = line.length - line.replace(/^ +/, "").length;
    const content = line.slice(indent);
    if (/^---\s*$/.test(content) || /^\.\.\.\s*$/.test(content)) {
      throw new YamlError("不支持多文档（--- / ...）", file, no);
    }
    out.push({ indent, text: content, no });
  }
  return out;
}

function isKeyStart(s: string): boolean {
  return KEY_RE.test(s);
}

function stripQuotes(s: string, state: State, no: number): string {
  const q = s[0];
  if (!s.endsWith(q) || s.length < 2) fail(state, no, `引号未闭合: ${s}`);
  const body = s.slice(1, -1);
  if (q === "'") return body.replace(/''/g, "'");
  return body
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
}

function parseScalar(s: string, state: State, no: number): YamlValue {
  const t = s.trim();
  if (t === "") return null;

  if (t.startsWith('"') || t.startsWith("'")) return stripQuotes(t, state, no);

  if (t.startsWith("[")) {
    if (!t.endsWith("]")) fail(state, no, `行内数组未闭合: ${t}`);
    const inner = t.slice(1, -1).trim();
    if (inner === "") return [];
    const parts: string[] = [];
    let cur = "";
    let quote: string | null = null;
    for (const ch of inner) {
      if (quote) {
        cur += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === "[" || ch === "]" || ch === "{") {
        fail(state, no, `行内数组不支持嵌套结构: ${t}`);
      }
      if (ch === ",") {
        parts.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (quote) fail(state, no, `行内数组里引号未闭合: ${t}`);
    parts.push(cur.trim());
    return parts.map((p) => parseScalar(p, state, no));
  }

  if (t.startsWith("{")) {
    fail(state, no, "不支持 flow mapping（{a: b}）—— 请改成嵌套块，否则含逗号/冒号的值会被悄悄切错");
  }
  if (t.startsWith("&") || t.startsWith("*")) {
    fail(state, no, `不支持锚点/别名（${t[0]}）`);
  }
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null" || t === "~") return null;
  if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return Number.parseFloat(t);

  // plain scalar 的硬约束：含 ": " 或 " #" 会让真 YAML 解析出不同结果，也可能掩盖拼写错误
  if (/:\s/.test(t)) {
    fail(state, no, `plain scalar 里含 ": "（${t.slice(0, 60)}…）—— 请加引号，否则真 YAML 解析器会截断`);
  }
  if (/\s#/.test(t)) {
    fail(state, no, `plain scalar 里含 " #"（${t.slice(0, 60)}…）—— 请加引号，否则会被当注释`);
  }
  return t;
}

function parseBlockScalar(state: State, parentIndent: number, no: number): string {
  const collected: string[] = [];
  let minIndent = Number.POSITIVE_INFINITY;
  while (state.i < state.lines.length) {
    const ln = state.lines[state.i];
    if (ln.indent <= parentIndent) break;
    if (ln.text.trim() !== "") minIndent = Math.min(minIndent, ln.indent);
    collected.push(ln.text);
    state.i++;
  }
  if (collected.length === 0) return "";
  const pad = Number.isFinite(minIndent) ? minIndent : parentIndent + 2;
  const out = collected.map((c) => c.replace(new RegExp(`^ {0,${pad}}`), ""));
  if (out.length === 0) fail(state, no, "块标量内容为空");
  return out.join("\n");
}

function parseMap(state: State, indent: number): YamlMap {
  const obj: YamlMap = {};
  while (state.i < state.lines.length) {
    const ln = state.lines[state.i];
    if (ln.indent < indent) break;
    if (ln.indent > indent) {
      fail(state, ln.no, `缩进超出预期（期望 ${indent} 空格，实际 ${ln.indent}）`);
    }
    if (ln.text.startsWith("- ")) break;
    const m = KEY_RE.exec(ln.text);
    if (!m) fail(state, ln.no, `无法解析为 key: value —— ${ln.text}`);
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      fail(state, ln.no, `重复的 key「${key}」（YAML 会静默取最后一个，这里直接拒绝）`);
    }
    const rest = ln.text.slice(m[0].length).trim();
    state.i++;

    if (rest === "" || rest === "|" || rest === "|-" || rest === ">") {
      const next = state.lines[state.i];
      if (rest === "|" || rest === "|-" || rest === ">") {
        obj[key] = parseBlockScalar(state, indent, ln.no);
      } else if (next && next.indent > indent) {
        obj[key] = parseNode(state, next.indent);
      } else {
        obj[key] = null;
      }
      continue;
    }
    obj[key] = parseScalar(rest, state, ln.no);
  }
  return obj;
}

function parseSeq(state: State, indent: number): YamlValue[] {
  const arr: YamlValue[] = [];
  while (state.i < state.lines.length) {
    const ln = state.lines[state.i];
    if (ln.indent < indent) break;
    if (ln.indent > indent) fail(state, ln.no, `序列项缩进超出预期（期望 ${indent}）`);
    if (!ln.text.startsWith("- ")) break;
    const rest = ln.text.slice(2).trim();
    if (rest === "") {
      state.i++;
      const next = state.lines[state.i];
      arr.push(next && next.indent > indent ? parseNode(state, next.indent) : null);
      continue;
    }
    if (isKeyStart(rest)) {
      // 序列里的映射项：把本行改写成「缩进 = 破折号缩进 + 2」再按映射解析
      state.lines[state.i] = { indent: indent + 2, text: rest, no: ln.no };
      arr.push(parseMap(state, indent + 2));
      continue;
    }
    arr.push(parseScalar(rest, state, ln.no));
    state.i++;
  }
  return arr;
}

function parseNode(state: State, indent: number): YamlValue {
  const ln = state.lines[state.i];
  if (!ln) return null;
  if (ln.indent > indent) fail(state, ln.no, `缩进异常（期望 ${indent}，实际 ${ln.indent}）`);
  if (ln.text.startsWith("- ") || ln.text === "-") return parseSeq(state, indent);
  return parseMap(state, indent);
}

export function parseYaml(text: string, file: string): YamlValue {
  const state: State = { lines: tokenize(text, file), i: 0, file };
  if (state.lines.length === 0) return {};
  const first = state.lines[0];
  if (first.indent !== 0) fail(state, first.no, `顶层不能缩进（实际 ${first.indent} 空格）`);
  const root = parseNode(state, 0);
  if (state.i < state.lines.length) {
    const ln = state.lines[state.i];
    fail(state, ln.no, `解析未消费完的内容: ${ln.text}`);
  }
  return root;
}
