/**
 * 轻量语言判定——只做一件事：判断「这段文字是不是中文」，决定要不要走翻译。
 *
 * 不引第三方语言检测库（franc / cld 都是几十 KB 起，且对内网部署无收益）。
 * 判定标准用 **CJK 字符占比**，因为资讯标题短、专有名词多，
 * 用「是否含中文」会把 `Anthropic 发布 Claude` 判成中文而漏翻。
 *
 * 阈值取舍（实测历史标题样本得出）：
 *   - `Torvalds: AI is fine for competent devs`  → 0    → 判英文 ✅
 *   - `iPhone 17 发布，售价上调`                   → ~0.4 → 判中文 ✅
 *   - `Anthropic 发布 Claude 3`                    → ~0.17 → 判英文 ✅（确实该翻）
 *   - `百度世界2026前瞻`                            → 0.6  → 判中文 ✅
 *   0.2 是能把「英文为主夹中文词」和「中文为主夹英文词」分开的那条线。
 */

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

/** CJK 汉字个数（不含标点：全角标点落在 \u3000-\u303f / \uff00-\uffef，不在本正则内） */
export function countCjk(text: string): number {
  return (text.match(CJK) ?? []).length;
}

/**
 * 判断文本是否「以中文为主」。
 *
 * @param threshold CJK 占比阈值，默认 0.2
 * @returns 空串返回 true —— 没有内容就没有可翻译的东西，不该触发翻译调用
 */
export function looksChinese(text: string, threshold = 0.2): boolean {
  const compact = (text ?? '').replace(/\s/g, '');
  if (!compact) return true;
  return countCjk(compact) / compact.length >= threshold;
}

/**
 * 粗分语言（只区分 zh / en / other）。
 *
 * 只用于落库统计与后续回填筛选，**不参与翻译决策**——决策看 `looksChinese`。
 * 拉丁字母占比高就记 en，其余一律 other：宁可标记粗一点，也不臆造语种。
 *
 * ⚠️ 空串必须在这里先挡掉：`looksChinese('')` 故意返回 true（没有内容就不该触发翻译），
 *    但那是「不用翻」的语义，不是「这段是中文」。直接复用会把空标题标成 zh，
 *    污染后续按 `source_lang` 回填的筛选条件。
 */
export function detectLang(text: string): 'zh' | 'en' | 'other' {
  const compact = (text ?? '').replace(/\s/g, '');
  if (!compact) return 'other';
  if (looksChinese(compact)) return 'zh';
  const latin = (compact.match(/[A-Za-z]/g) ?? []).length;
  return latin / compact.length >= 0.5 ? 'en' : 'other';
}
