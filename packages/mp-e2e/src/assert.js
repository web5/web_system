/**
 * 简易断言（纯函数，迁移自 dachengzi helper.js L159–171，原样）
 */

/** 失败抛错并带期望值 vs 实际值 + 标签 */
function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`[FAIL] ${label}\n  expected: ${b}\n  actual:   ${a}`);
  }
}

function assertOk(cond, label, detail) {
  if (!cond) {
    throw new Error(`[FAIL] ${label}${detail ? `\n  detail: ${detail}` : ''}`);
  }
}

module.exports = { assertEqual, assertOk };
