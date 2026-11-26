/**
 * 首页 `Page({ data })` 初值静态判据（E2E G3 的唯一实现，台账 9085）
 *
 * 背景：G3 原先在用例里用两个 `正则取全文第一个匹配` 判断「data 初值是否按登录态求值」，
 * 属**弱锁**，独立复核实测两条回退都能绕过它仍判 PASS：
 *   ① 删掉 `Page({ data })` 里的 `loggedIn` 初值行，只留 `onShow` 里的
 *      `setData({ loggedIn: isLoggedIn() })` —— 全文正则仍能命中那行，假绿；
 *      但首帧渲染发生在 onShow 之前，hero 仍会闪一帧。
 *   ② `greetingText` 只校验「这一行含 isLoggedIn」，不校验三元 false 分支 ——
 *      写 `isLoggedIn() ? GREETING_LOADING : GREETING_LOADING` 仍 PASS，
 *      而未登录首帧会拿到「…」，正是台账 9045 判据要挡的缺陷。
 *
 * 故本模块把判据抽成纯函数（零 IO、无 wx 依赖），**只在 `Page({ data: { ... } })`
 * 的 data 对象字面量内部**取值：按花括号配对定位 `data:` 后的对象块，
 * 绝不命中 `onShow` / `setData` / 其它函数体里的同名键。
 *
 * 判据（两条必须同时成立，否则 problems 非空）：
 *   ① data 块内 `loggedIn` 的值是 `isLoggedIn()` 调用（不是 `true`、不是漏括号的函数引用）；
 *   ② data 块内 `greetingText` 是三元表达式，且**false 分支为空串 `''` / `""`**
 *      （未登录是「确定的空态」，留占位/文案就会闪「…」）。
 *
 * 实现要点（为什么这么写）：
 *  - 先做一次「注释 + 字符串内容」掩码（长度不变、保留引号），再在掩码串上做结构定位：
 *    源码块注释里出现的 `Page({data})` 字样、以及 `'loggedIn: true'` 这类字符串字面量，
 *    都不会被误当成代码命中。
 *  - 保留引号不掩码，故掩码串里仍能区分 `''` / `""`（空串）与 `'abc'`（非空串）。
 *  - problems 里带**行号 + 实际取到的值**，E2E FAIL 时一眼归位。
 */

'use strict';

const LOGGED_IN = 'loggedIn';
const GREETING = 'greetingText';

/** 标识符字符（用于保证 `data` / `loggedIn` 是完整标识符，不命中 `myData` / `loggedInFlag`） */
function isIdentChar(ch) {
  return !!ch && /[A-Za-z0-9_$]/.test(ch);
}

/** 行号（1 基），用于 problems 报位 */
function lineOf(source, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < source.length; i++) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

/**
 * 掩码注释与字符串**内容**（保持长度不变，便于用同一套下标回原文取值）。
 * - 注释整体掩成空格（换行保留，行号不变）；
 * - 字符串/模板串只掩内容、保留引号本身（`''` 与 `""` 在掩码串里仍是 `''` / `""`）。
 */
function maskCommentsAndStrings(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    // 行注释
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') {
        out[i] = ' ';
        i += 1;
      }
      continue;
    }
    // 块注释
    if (c === '/' && c2 === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      if (i < n) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    // 字符串 / 模板串：只掩内部字符，引号保留
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        j += 1;
      }
      const stop = Math.min(j, n);
      for (let k = i + 1; k < stop; k++) {
        if (src[k] !== '\n') out[k] = ' ';
      }
      i = stop + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** 从 openIdx（必须是 '{'）找配对的 '}'，返回其下标；不配对返回 -1 */
function matchBrace(masked, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 在 [open, close] 对象块内找**顶层**属性 `key`，返回其值起止下标。
 * @returns {{ keyStart:number, valueStart:number } | null}
 */
function findTopLevelProp(masked, open, close, key) {
  let depth = 0;
  let i = open + 1;
  while (i < close) {
    const c = masked[i];
    if (c === '{' || c === '(' || c === '[') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && masked.startsWith(key, i) && !isIdentChar(masked[i - 1]) && !isIdentChar(masked[i + key.length])) {
      let j = i + key.length;
      while (j < close && /\s/.test(masked[j])) j += 1;
      if (masked[j] === ':') {
        let v = j + 1;
        while (v < close && /\s/.test(masked[v])) v += 1;
        return { keyStart: i, valueStart: v };
      }
    }
    i += 1;
  }
  return null;
}

/**
 * 从 valueStart 扫到值的结束（顶层 ',' 或容器闭合 '}'），返回 exclusive 结束下标。
 * 用掩码串做深度跟踪，故 `foo(a, b)` / `{a: 1, b: 2}` / `[1, 2]` 内部的逗号不会误判。
 */
function scanValueEnd(masked, valueStart, containerClose) {
  let depth = 0;
  let i = valueStart;
  while (i < containerClose) {
    const c = masked[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') {
      if (depth === 0) break; // 容器自身的闭合括号，值在此结束
      depth -= 1;
    } else if (c === ',' && depth === 0) break;
    i += 1;
  }
  return i;
}

/**
 * 在 [start, end) 内定位**顶层**三元：返回 { questionIdx, colonIdx }（找不到返回 null）。
 * 处理嵌套三元（`a ? b : c ? d : e` 取最外层）与 `?.` / `??`（跳过不算三元分隔符）。
 */
function findTopLevelTernary(masked, start, end) {
  let depth = 0;
  let questionIdx = -1;
  let pending = 0;
  for (let i = start; i < end; i++) {
    const c = masked[i];
    if (c === '{' || c === '(' || c === '[') {
      depth += 1;
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (c === '?') {
      const next = masked[i + 1];
      if (next === '?' || next === '.') {
        i += 1; // 可选链 / 空值合并，不是三元
        continue;
      }
      if (questionIdx < 0) {
        questionIdx = i;
        pending = 1;
      } else {
        pending += 1;
      }
      continue;
    }
    if (c === ':' && pending > 0) {
      pending -= 1;
      if (pending === 0) return { questionIdx, colonIdx: i };
    }
  }
  return null;
}

/** 定位 `Page({ data: {...} })` 中 data 对象块；找不到返回 null */
function findPageDataBlock(source) {
  const masked = maskCommentsAndStrings(source);
  const pageRe = /\bPage\s*\(\s*\{/g;
  let m;
  while ((m = pageRe.exec(masked)) !== null) {
    const optOpen = masked.indexOf('{', m.index + 4);
    if (optOpen < 0) continue;
    const optClose = matchBrace(masked, optOpen);
    if (optClose < 0) continue;
    const dataProp = findTopLevelProp(masked, optOpen, optClose, 'data');
    if (!dataProp) continue;
    if (masked[dataProp.valueStart] !== '{') continue; // data 不是对象字面量 → 换下一个 Page(
    const dataClose = matchBrace(masked, dataProp.valueStart);
    if (dataClose < 0) continue;
    return { masked, dataOpen: dataProp.valueStart, dataClose, optOpen, optClose };
  }
  return null;
}

/**
 * 校验首页 index.ts 的 data 初值是否「按登录态求值」。
 *
 * @param {string} source 首页 `pages/home/index/index.ts` 源码全文
 * @returns {{ ok: boolean, problems: string[], values: { loggedIn: string|null, greetingText: string|null }, dataLine: number|null }}
 *   ok === true 表示两条判据同时成立；
 *   problems 非空且逐条说明**哪一条不成立 + 第几行 + 实际取到的值**；
 *   values / dataLine 是诊断附加信息（E2E 失败时可直接打出来）。
 */
function checkHomeInitState(source) {
  const problems = [];
  const result = { ok: false, problems, values: { loggedIn: null, greetingText: null }, dataLine: null };

  if (typeof source !== 'string' || source.trim() === '') {
    problems.push('源码为空（读不到首页 index.ts 内容）');
    return result;
  }

  const block = findPageDataBlock(source);
  if (!block) {
    problems.push('找不到 `Page({ data: { ... } })` 的 data 对象块（无顶层 data 属性，或花括号不配对）');
    return result;
  }
  const { masked, dataOpen, dataClose } = block;
  result.dataLine = lineOf(source, dataOpen);

  // ── 判据①：data 块内 loggedIn 必须是 isLoggedIn() 调用 ──
  const liProp = findTopLevelProp(masked, dataOpen, dataClose, LOGGED_IN);
  if (!liProp) {
    problems.push(
      `data 块内缺少 ${LOGGED_IN} 初值（第 ${result.dataLine} 行起）：必须在 Page({ data }) 里显式写 isLoggedIn()；` +
        `只靠 onShow 的 setData({ ${LOGGED_IN}: ... }) 不算——首帧在 onShow 之前就已渲染`,
    );
  } else {
    const liEnd = scanValueEnd(masked, liProp.valueStart, dataClose);
    const raw = source.slice(liProp.valueStart, liEnd).trim();
    const code = masked.slice(liProp.valueStart, liEnd).trim();
    result.values.loggedIn = raw;
    // 允许 TS 类型断言尾巴（`isLoggedIn() as boolean`），不允许 `true` / 漏括号
    const isCall = /^isLoggedIn\s*\(\s*\)(\s+as\s+[\w$.<>[\]]+)?$/.test(code);
    if (!isCall) {
      const hint = /^isLoggedIn$/.test(code)
        ? '（漏了调用括号：取到的是函数对象而不是调用结果，恒真）'
        : /^(true|false|\d+)$/.test(code)
          ? '（写死字面量：与登录态无关）'
          : '';
      problems.push(
        `${LOGGED_IN} 初值不是 isLoggedIn() 调用${hint}（第 ${lineOf(source, liProp.keyStart)} 行，实际取到 ${JSON.stringify(raw)}）`,
      );
    }
  }

  // ── 判据②：data 块内 greetingText 必须是三元，且 false 分支为空串 ──
  const gtProp = findTopLevelProp(masked, dataOpen, dataClose, GREETING);
  if (!gtProp) {
    problems.push(
      `data 块内缺少 ${GREETING} 初值（第 ${result.dataLine} 行起）：必须按登录态求值，未登录首帧要是空串`,
    );
  } else {
    const gtEnd = scanValueEnd(masked, gtProp.valueStart, dataClose);
    const raw = source.slice(gtProp.valueStart, gtEnd).trim();
    const code = masked.slice(gtProp.valueStart, gtEnd).trim();
    const line = lineOf(source, gtProp.keyStart);
    result.values.greetingText = raw;

    const tern = findTopLevelTernary(masked, gtProp.valueStart, gtEnd);
    if (!tern) {
      problems.push(
        `${GREETING} 初值不是三元表达式（第 ${line} 行，实际取到 ${JSON.stringify(raw)}）：写死文案/占位会让未登录首帧就显示内容`,
      );
    } else {
      // 条件必须引用登录态（isLoggedIn() 调用，或已解析的 loggedIn 字段）
      const condCode = masked.slice(gtProp.valueStart, tern.questionIdx).trim();
      if (!/\bisLoggedIn\s*\(/.test(condCode) && !/\bloggedIn\b/.test(condCode)) {
        problems.push(
          `${GREETING} 三元的条件没有引用登录态（第 ${line} 行，条件=${JSON.stringify(condCode)}）：条件恒定时两支等价于写死`,
        );
      }
      // false 分支必须是空串字面量（掩码串保留引号，故能区分 '' / "" 与 '文案'）
      const falseCode = masked.slice(tern.colonIdx + 1, gtEnd).trim();
      const falseRaw = source.slice(tern.colonIdx + 1, gtEnd).trim();
      if (falseCode !== "''" && falseCode !== '""') {
        problems.push(
          `${GREETING} 三元的 false 分支不是空串 '' / ""（第 ${line} 行，实际取到 ${JSON.stringify(falseRaw)}）：` +
            `未登录首帧会显示占位/文案（台账 9045 要挡的「…」回退）`,
        );
      }
    }
  }

  result.ok = problems.length === 0;
  return result;
}

module.exports = { checkHomeInitState, maskCommentsAndStrings, findPageDataBlock };
