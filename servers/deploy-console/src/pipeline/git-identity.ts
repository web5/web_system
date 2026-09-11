/**
 * 拉码结果的版本身份与一致性断言（纯函数，便于单测）。
 *
 * R6 版本身份 = `<templateKey>/<commit>`（产物落 `modules/<module>/<key>/<commit>/`，
 * 指针值 = 完整引用）；无 templateKey 时退化为纯 commit（legacy 兼容）。
 */

/** 组装版本引用：`<templateKey>/<commit>` 或纯 `<commit>` */
export function buildVersionRef(templateKey: string | undefined, commit: string): string {
  return templateKey ? `${templateKey}/${commit}` : commit;
}

/**
 * 拉码一致性断言：请求了 commit 时，实际 HEAD 必须等于它。
 *
 * 比对用**全哈希**（调用方自行 `git rev-parse --verify <commit>^{commit}` 与 `HEAD`），
 * 避免短哈希位数差异误判；不一致即抛错中止发布 ——
 * 宁可不发，也不能出现「传了版本引用却打出分支最新代码」的历史高危场景。
 *
 * @param requested 入参 commit（流水线实例的 requestedCommit 快照）；为空则不校验
 * @param wantFull  请求的 commit 解析出的全哈希（不可达时传 null）
 * @param gotFull   实际 HEAD 的全哈希
 */
export function assertCommitMatch(
  requested: string | undefined,
  wantFull: string | null,
  gotFull: string | null,
): void {
  if (!requested) return;
  if (!wantFull || !gotFull || wantFull !== gotFull) {
    const got = (gotFull ?? '未知').slice(0, 8);
    const want = (wantFull ?? '不可达').slice(0, 8);
    throw new Error(
      `拉码结果与请求不一致：实际 HEAD=${got}，期望 ${requested}（${want}）→ 已中止发布`,
    );
  }
}
