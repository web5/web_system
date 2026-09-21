/**
 * 流水线条件表达式引擎（纯函数，可直接单测）。
 *
 * 一处实现、两处使用（specs/pipeline-step-branch/design.md §2）：
 * - 步骤执行条件（gate）：不满足 → 跳过整个步骤
 * - 步骤任务匹配条件：不满足 → 继续匹配下一个任务
 *
 * 语法：
 *   expr  := term (&& term)*
 *   term  := KEY op VALUE
 *   op    := == | !=
 *   KEY   := [A-Za-z_][A-Za-z0-9_]*
 *   VALUE := [A-Za-z0-9._/@:-]+ | '引号串' | "引号串"
 *
 * **不做**任意脚本求值（不 eval / 不 bash -c 判真假）：
 * 流水线配置来自控制台表单，求值必须是可静态校验、可单测、无注入面的白盒逻辑。
 * 需要复杂判断时，把判断写进任务脚本内部（脚本本来就是任意逻辑的执行体）。
 */

export type ConditionVars = Record<string, string | number | undefined | null>;

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BARE_VALUE_RE = /^[A-Za-z0-9._/@:-]+$/;
const MAX_LEN = 255;

/** 校验结果：ok=false 时 reason 可直接作为 400 文案给用户 */
export interface ConditionCheck {
  ok: boolean;
  reason?: string;
}

/** 校验条件表达式语法（空串合法 = 无条件，恒真） */
export function validateCondition(expr: string | null | undefined): ConditionCheck {
  const raw = String(expr ?? '').trim();
  if (!raw) return { ok: true };
  if (raw.length > MAX_LEN) return { ok: false, reason: `执行条件过长（>${MAX_LEN} 字符）` };

  for (const rawTerm of raw.split('&&')) {
    const term = rawTerm.trim();
    if (!term) return { ok: false, reason: '存在空的 && 条件项' };
    const m = term.match(/^(\S+)\s*(==|!=)\s*(.+)$/);
    if (!m) {
      return { ok: false, reason: `条件项不合法: ${term}（应为 KEY == 值 或 KEY != 值）` };
    }
    const [, key, , value] = m;
    if (!KEY_RE.test(key)) return { ok: false, reason: `变量名不合法: ${key}` };
    const v = value.trim();
    const quoted = /^'.*'$/.test(v) || /^".*"$/.test(v);
    if (!quoted && !BARE_VALUE_RE.test(v)) {
      return { ok: false, reason: `取值不合法: ${v}（含空格或特殊字符请用引号包裹）` };
    }
  }
  return { ok: true };
}

/**
 * 求值。
 *
 * @param expr 条件；空/空串 = 无条件，恒真
 * @param vars 执行期变量（缺失的变量视为空串参与比较）
 * @throws 表达式非法（调用方应在保存前 validate，运行期再抛即 fail-fast）
 */
export function evalCondition(expr: string | null | undefined, vars: ConditionVars): boolean {
  const raw = String(expr ?? '').trim();
  if (!raw) return true;

  const check = validateCondition(raw);
  if (!check.ok) throw new Error(`执行条件非法：${check.reason}`);

  for (const rawTerm of raw.split('&&')) {
    const m = rawTerm.trim().match(/^(\S+)\s*(==|!=)\s*(.+)$/);
    if (!m) return false; // 已校验，理论不可达；保守判假
    const [, key, op, value] = m;
    const actual = String(vars[key] ?? '').trim();
    const want = unquote(value.trim());
    if (op === '==' ? actual !== want : actual === want) return false;
  }
  return true;
}

/** 去掉配对的引号（校验阶段已保证成对） */
function unquote(v: string): string {
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    return v.slice(1, -1);
  }
  return v;
}
