/**
 * J. 首页 hero 长昵称布局不挤出（台账 9042）
 *
 * 需求判据：昵称上限是 16 字素簇（utils/greeting.ts NICKNAME_MAX_CHARS），
 * 到顶时 hero 区必须仍然「不挤出、不压副标题、emoji 无半截字形」。
 * 本用例做的是**真实布局测量**（渲染层 rect + 计算样式），不是读源码推断。
 *
 * ── 为什么这么测（每一条都是踩过坑的结论）──
 * ① line-height 在开发者工具里取不到像素值：`element.style('line-height')` 返回字符串
 *    'normal'（不是 getComputedStyle 的 used value），拿不到 px 就没法用「height / lineHeight」
 *    算行数。故本用例改用**同场景单行控制组**：先用 1 个汉字的短昵称渲染一次，实测 .hi 的
 *    单行高度（当前设备 = 25px），再拿长昵称的 .hi 高度与它比 —— 这是实测 used value，
 *    比解析计算样式更硬。
 * ② createSelectorQuery 的 `fields({computedStyle})` / `NodeRef.scrollOffset()` /
 *    Element.domProperty(['scrollWidth']) 在本机开发者工具（36.x + automator 0.12.1）实测
 *    都拿不到可用值：fields 会触发「An object could not be cloned.」（结构化克隆失败，
 *    exec 回调参数在渲染层→逻辑层回传时就炸了），scrollOffset 恒返回 0，domProperty 里
 *    scrollWidth/clientWidth 恒返回 null。故横向溢出不能靠 scrollWidth > clientWidth 判。
 * ③ white-space 也拿不到：`element.style('white-space')` 恒返回 null（即使显式写了
 *    `white-space: nowrap` 也返回 null，已实测），所以「不许 nowrap」不能写成读样式比对
 *    —— 那会是一条必然为真的假断言。
 * ④ 于是「无横向溢出」拆成三条真判据：
 *    3a .hi.right 不出屏（视口）、
 *    3c .hi.right / .hi-sub.right 不超出 .hero 卡片（抓「.hero-tx 丢了 min-width: 0 → 长昵称顶出卡片」这个
 *       最典型的挤出回归；已用变异实测：删掉 min-width: 0 后本判据变红）、
 *    3b 必须换行 —— 用 font-size 与字素簇数估算文本自身宽度，估算宽 > 可用宽 ×1.1 时，
 *       .hi 就必须占到 ≥ 1.5 行；只占 1 行 = 文本没换行 = 横向溢出。
 *       这条是唯一能抓住 `white-space: nowrap` 回归的判据（已用变异实测：改成 nowrap 后
 *       .hi 高度 50 → 25，本判据变红）。估算宽用比例门槛（> 可用宽 1.1 倍才启用），
 *       避免在更宽的设备上（16 字真能一行放下）误红。
 * ⑤ 选择器有效性反证（J4）不可省：rect 拿不到可能是 automator 选择器失效，而非布局没渲染，
 *    不先证「三个节点都命中」就等于给自己留了一个假绿口子（README 已知限制④）。
 *
 * ── 环境要点（缺一个就会假红/闪断）──
 * 🔴 api_base 必须指向不可达地址再注入假 token：否则 /api/auth/verify 返 401 会清 token，
 *    页面中途翻回 login-gate（hero 消失），用例随机红。网络错误不走 401 清 token 分支，
 *    fetchProfile reject 后首页兜底 `applyGreeting(readLocalNickname())`，正好用上注入的昵称。
 * 🔴 全程串行 await：导航未完成就并发 currentPage() / page.data() 会让开发者工具主进程崩。
 */
const fs = require('fs');
const path = require('path');

/** 16 个汉字（正好是 NICKNAME_MAX_CHARS 上限，不受截断影响） */
const CN16 = '一二三四五六七八九十一二三四五六';

/**
 * 16 簇 emoji（构成：8 面旗帜 🇨🇳🇺🇸🇯🇵🇰🇷🇩🇪🇫🇷🇮🇹🇪🇸 + 1 个 ZWJ 家庭 👨‍👩‍👧‍👦 +
 * 1 个带肤色修饰的 👍🏽 + 1 个带变体选择符的 ❤️ + 5 个 😀 = 16 簇）。
 * 覆盖了最容易切出残字的三类：区域指示符成对、ZWJ 连字、肤色/VS16 扩展器。
 * 已用 Intl.Segmenter(x, {granularity:'grapheme'}) 核对恰好 16 簇。
 */
const EMOJI16 = '🇨🇳🇺🇸🇯🇵🇰🇷🇩🇪🇫🇷🇮🇹🇪🇸👨‍👩‍👧‍👦👍🏽❤️😀😀😀😀😀';

const HOME = '/pages/home/index/index';

/** storage 快照/恢复用到的 key 别名（真值见 e2e.config.js storageKeys） */
const SNAPSHOT_ALIASES = ['token', 'refreshToken', 'loggedOut', 'nickname', 'apiBase'];

/** 单个汉字/全角字符相对字号的宽度比（宽字符按 1.0） */
const NARROW_RATIO = 0.55;
/** 启用「必须换行」判据的宽度余量：估算宽 > 可用宽 × 该系数 才要求换行（防宽屏误红） */
const WIDTH_MARGIN = 1.1;

/** 读数保留 1 位小数，仅用于 detail 可读性（不参与断言） */
const fmt = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

/**
 * 按字素簇切分（优先 Intl.Segmenter，回退按码点切）。
 * 只用于 Node 侧估算文本宽度，与产品侧 utils/greeting.ts 的切分器同口径（簇级）。
 */
function splitClusters(text) {
  const s = String(text || '');
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
      const out = [];
      for (const part of seg.segment(s)) out.push(part.segment);
      return out;
    } catch {
      /* 回退到码点切分 */
    }
  }
  return Array.from(s);
}

/** CJK / 全角 / 韩文等「按 1 个字号宽」的 BMP 区间 */
function isWideBmp(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // 韩文字母
    (cp >= 0x2e80 && cp <= 0xa4cf) || // CJK 部首·汉字·假名·注音
    (cp >= 0xac00 && cp <= 0xd7a3) || // 韩文音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容汉字
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII
    (cp >= 0xffe0 && cp <= 0xffe6) // 全角符号
  );
}

/**
 * 估算文本自身排版宽度（px）。
 * 宽字符（CJK/全角/emoji/任意星界字符/含扩展器的多码点簇）按 1 个字号宽，
 * 其余（拉丁·数字·空格）按 NARROW_RATIO 个字号宽。
 * 这是**估算**，只用于「文本是否必须换行」的比例判据（门槛 1.1 倍），不用于精确断言。
 */
function estimateTextWidth(text, fontSizePx, letterSpacingPx) {
  const clusters = splitClusters(text);
  let w = 0;
  for (const c of clusters) {
    const cp = c.codePointAt(0) || 0;
    const wide = c.length > 1 || cp > 0xffff || isWideBmp(cp);
    w += wide ? fontSizePx : fontSizePx * NARROW_RATIO;
  }
  return w + clusters.length * (Number(letterSpacingPx) || 0);
}

/**
 * 从计算样式值里解析 px 数值（如 '18px' → 18）；取不到/不可解析返回 null。
 * 🔴 line-height 会返回 'normal'，故这里返回 null —— 行高改由单行控制组实测（见头注①）。
 */
function parsePx(v) {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v == null ? '' : v).trim());
  return m ? Number(m[1]) : null;
}

/**
 * hero 布局判据（纯函数）：返回问题清单，空数组 = 全部通过。
 * 输入全部来自真实测量，不做任何源码推断。
 *
 * @param {{hi:object,hiSub:object,hero:object,viewport:object,lineHeight:number,
 *          clamp:string,fontSize:number,letterSpacing:number,text:string}} m
 * @returns {string[]}
 */
function heroLayoutProblems(m) {
  const problems = [];
  const { hi, hiSub, hero, viewport, lineHeight, clamp, fontSize, text } = m;
  if (!hi || !hiSub || !hero || !viewport) {
    problems.push(
      `rect 缺失：hi=${!!hi} hiSub=${!!hiSub} hero=${!!hero} viewport=${!!viewport}（缺 rect 时任何布局断言都不可信）`,
    );
    return problems;
  }
  const detail =
    `hi=${JSON.stringify({ l: fmt(hi.left), r: fmt(hi.right), t: fmt(hi.top), b: fmt(hi.bottom), w: fmt(hi.width), h: fmt(hi.height) })} ` +
    `hiSub=${JSON.stringify({ l: fmt(hiSub.left), r: fmt(hiSub.right), t: fmt(hiSub.top), b: fmt(hiSub.bottom), h: fmt(hiSub.height) })} ` +
    `hero=${JSON.stringify({ t: fmt(hero.top), b: fmt(hero.bottom), h: fmt(hero.height) })} ` +
    `viewport=${JSON.stringify({ w: fmt(viewport.width) })} lineHeight(单行实测)=${fmt(lineHeight)} ` +
    `clamp=${JSON.stringify(clamp)} fontSize=${fmt(fontSize)} text=${JSON.stringify(text)}`;

  // ── 判据 1：不压副标题 + hero 容纳两行内容 ──
  if (!(hi.bottom <= hiSub.top + 1)) {
    problems.push(`[压副标题] .hi.bottom=${fmt(hi.bottom)} > .hi-sub.top=${fmt(hiSub.top)}+1（第 1 行末尾压到副标题）`);
  }
  if (!(hero.bottom >= hiSub.bottom)) {
    problems.push(`[hero 装不下] .hero.bottom=${fmt(hero.bottom)} < .hi-sub.bottom=${fmt(hiSub.bottom)}（内容溢出卡片）`);
  }
  if (!(hero.top <= hi.top + 1)) {
    problems.push(`[hero 顶部越界] .hero.top=${fmt(hero.top)} > .hi.top=${fmt(hi.top)}+1`);
  }
  if (!(hiSub.height > 0)) {
    problems.push(`[副标题塌陷] .hi-sub.height=${fmt(hiSub.height)}（副标题没渲染出行高）`);
  }

  // ── 判据 2：不超过 2 行（行高用单行控制组实测值）──
  if (!(lineHeight > 0)) {
    problems.push(`[控制组无效] 单行控制高度=${fmt(lineHeight)}，无法判行数（短昵称场景没量到）`);
  } else if (!(hi.height <= 2 * lineHeight + 2)) {
    problems.push(
      `[超出 2 行] .hi.height=${fmt(hi.height)} > 2×单行高(${fmt(lineHeight)})+2=${fmt(2 * lineHeight + 2)}（长昵称把 hero 撑高）`,
    );
  }

  // ── 判据 3：无横向溢出 ──
  // 3a 右边界不出屏（结构性兜底）
  if (!(hi.right <= viewport.width + 1)) {
    problems.push(`[右边界出屏] .hi.right=${fmt(hi.right)} > viewport.width=${fmt(viewport.width)}+1`);
  }
  // 3c 不挤出卡片：.hero-tx 是 .hero（flex row）的子项，靠 `min-width: 0` 才能收缩；
  //    一旦这行样式丢了，长昵称的 min-content 宽会把整块顶出卡片右侧 —— 这正是「挤出」本体。
  //    .hi / .hi-sub 都是 hero-tx 的子节点，右边界必须留在 .hero 盒内。
  if (!(hi.right <= hero.right + 1)) {
    problems.push(`[挤出卡片] .hi.right=${fmt(hi.right)} > .hero.right=${fmt(hero.right)}+1（长昵称把文本顶出 hero 卡片）`);
  }
  if (!(hiSub.right <= hero.right + 1)) {
    problems.push(`[副标题挤出卡片] .hi-sub.right=${fmt(hiSub.right)} > .hero.right=${fmt(hero.right)}+1`);
  }
  // 3b 必须换行：估算文本宽 > 可用宽时，只占 1 行就说明文本没换行（必然会横向溢出/被切）
  const usable = Math.max(1, hi.width);
  const textWidth = estimateTextWidth(text, fontSize, m.letterSpacing);
  const neededLines = Math.max(1, Math.ceil(textWidth / usable));
  if (textWidth > usable * WIDTH_MARGIN && !(hi.height >= 1.5 * lineHeight)) {
    problems.push(
      `[文本未换行=横向溢出] 文本估算宽=${fmt(textWidth)}px > 可用宽=${fmt(usable)}px×${WIDTH_MARGIN}` +
        `（需 ≥${neededLines} 行），但 .hi.height=${fmt(hi.height)}px 仅 ≈1 行（单行高 ${fmt(lineHeight)}px）`,
    );
  }

  // ── 判据 4：不被裁切（-webkit-line-clamp）──
  // 现状 .hi 没有 clamp（实测计算值 'none'）→ 本判据不启用；
  // 一旦有人给 .hi 加 `display:-webkit-box; -webkit-line-clamp:N`，N 必须 ≥ 文本所需行数，
  // 否则尾行被裁（"16 字昵称只显示半句"就是这种形态）。
  const clampN = /^\d+$/.test(String(clamp == null ? '' : clamp).trim()) ? Number(clamp) : null;
  if (clampN !== null && clampN < neededLines) {
    problems.push(`[被 clamp 裁切] -webkit-line-clamp=${clampN} < 文本所需 ${neededLines} 行（尾行不可见）`);
  }

  if (problems.length > 0) problems.push(detail);
  return problems;
}

/**
 * 装进渲染层执行的测量函数（会被 mp.evaluate 序列化后在小程序逻辑层执行）。
 * 🔴 必须自包含：不能引用模块作用域的任何变量（序列化后闭包不复存在）。
 * 🔴 只取 boundingClientRect（纯几何数值，结构化克隆安全）；
 *    千万不要在这里加 fields({computedStyle}) / scrollOffset() —— 实测会炸（见头注②）。
 */
function measureHeroLayout() {
  // eslint-disable-next-line no-undef
  return new Promise((resolve) => {
    // eslint-disable-next-line no-undef
    const q = wx.createSelectorQuery();
    const rect = (r) =>
      r
        ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
        : null;
    q.select('.hi').boundingClientRect();
    q.select('.hi-sub').boundingClientRect();
    q.select('.hero').boundingClientRect();
    q.selectViewport().boundingClientRect();
    q.exec((res) => {
      resolve({ hi: rect(res[0]), hiSub: rect(res[1]), hero: rect(res[2]), viewport: rect(res[3]) });
    });
  });
}

/** 读某个 class 节点的一条计算样式（取不到返回 null，由调用方决定怎么用） */
async function readStyle(page, selector, name) {
  const el = await page.$(selector);
  if (!el) return null;
  try {
    return await el.style(name);
  } catch {
    return null;
  }
}

/** 一句能把「改坏了什么」说清的前缀断言：greetingText 必须以期望串开头 */
function assertGreetingPrefix(actual, expectedPrefix, label) {
  if (typeof actual !== 'string' || actual.indexOf(expectedPrefix) !== 0) {
    throw new Error(
      `[FAIL] ${label}\n  expected prefix: ${JSON.stringify(expectedPrefix)}\n  actual:          ${JSON.stringify(actual)}`,
    );
  }
}

module.exports = {
  name: 'J. 首页 hero 长昵称布局不挤出（台账 9042）',
  async run(ctx) {
    const { mp } = ctx;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const snapshot = {};
    /** 单行控制高度（短昵称实测）与短昵称 rect，供 J6/J7 判行数用 */
    let lineHeight = 0;
    let controlGreeting = '';

    /**
     * 串行轮询直到 greetingText 以期望前缀开头（不用固定 sleep 赌渲染时机）。
     * 🔴 每一步都 await 完再进下一次，导航中并发读 page 会崩主进程。
     */
    async function waitGreeting(prefix, label) {
      const t0 = Date.now();
      let last = '';
      while (Date.now() - t0 < 15000) {
        try {
          const p = await mp.currentPage();
          if (p && p.path === 'pages/home/index/index') {
            const d = await p.data();
            last = (d && d.greetingText) || '';
            if (last !== '' && last !== '…' && last.indexOf(prefix) === 0) return last;
          }
        } catch {
          /* 重建期竞态：忽略，继续轮询 */
        }
        await sleep(200);
      }
      throw new Error(
        `${label}: 等 greetingText 以 ${JSON.stringify(prefix)} 开头超时(15s)，最后一次=${JSON.stringify(last)}`,
      );
    }

    /** 换昵称 → reLaunch 首页 → 等问候出现，返回 greetingText */
    async function renderWithNickname(nickname, prefix, label) {
      await ctx.setStorage(mp, ctx.KEYS.nickname, nickname);
      await ctx.reLaunch(mp, HOME);
      return waitGreeting(prefix, label);
    }

    /** 采一帧真实布局 + 计算样式（单帧内一次性取完，避免与重绘交错） */
    async function measureScene() {
      const rects = await mp.evaluate(measureHeroLayout);
      const page = await mp.currentPage();
      // 逐个串行读样式（automator 是串行协议，不并发）
      const lineHeightStyle = await readStyle(page, '.hi', 'line-height');
      const fontSizeRaw = await readStyle(page, '.hi', 'font-size');
      const letterSpacingRaw = await readStyle(page, '.hi', 'letter-spacing');
      const clampRaw = await readStyle(page, '.hi', '-webkit-line-clamp');
      return {
        rects,
        styles: {
          lineHeightStyle,
          fontSize: parsePx(fontSizeRaw),
          letterSpacing: parsePx(letterSpacingRaw) || 0,
          clamp: clampRaw,
        },
      };
    }

    // ── J1 快照 storage：本用例会把开发者工具置成「已登录 + 长昵称」态，
    //    结束时必须按原值恢复，否则污染同一开发者工具里的后续用例与人工调试。
    await ctx.run('J1 快照 storage 五个 key 原值', async () => {
      for (const alias of SNAPSHOT_ALIASES) {
        snapshot[alias] = await ctx.getStorage(mp, ctx.KEYS[alias]);
      }
      // 快照不打印真实凭据，只报有无
      ctx.assertOk(
        SNAPSHOT_ALIASES.every((a) => snapshot[a] !== undefined),
        '五个 key 均已读取（undefined 说明 KEYS 别名写错）',
        `keys=${JSON.stringify(SNAPSHOT_ALIASES)} snapshot=${JSON.stringify(
          Object.fromEntries(SNAPSHOT_ALIASES.map((a) => [a, snapshot[a] ? '<set>' : '<empty>'])),
        )}`,
      );
    });

    // ── J2 造「已登录 + 1 汉字短昵称」态：短昵称这一帧是 J6/J7 判行数的**单行控制组**
    await ctx.run('J2 造已登录态（api_base 指向不可达 + 假 token）+ 短昵称控制组', async () => {
      // api_base 先指向不可达地址：/api/auth/verify 拿不到响应就不会返回 401，token 不会被清，
      // 页面不会中途翻回 login-gate（否则 hero 消失 → 用例随机红）。
      await ctx.setStorage(mp, ctx.KEYS.apiBase, 'http://127.0.0.1:1');
      await ctx.setStorage(mp, ctx.KEYS.token, 'e2e-fake-token');
      await ctx.removeStorage(mp, ctx.KEYS.loggedOut);
      await ctx.setStorage(mp, ctx.KEYS.nickname, '橙');
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.apiBase), 'http://127.0.0.1:1', 'api_base 指向不可达地址');
      ctx.assertOk(!!(await ctx.getStorage(mp, ctx.KEYS.token)), 'access_token 已注入', 'token=<set>');
      ctx.assertEqual(await ctx.getStorage(mp, ctx.KEYS.loggedOut), '', 'account_logged_out 已移除');
    });

    // ── J3 渲染控制组：reLaunch + 等问候出现（昵称走 readLocalNickname 秒显，不需要 setData）
    await ctx.run('J3 reLaunch 首页并等控制组问候渲染（短昵称）', async () => {
      await ctx.reLaunch(mp, HOME);
      controlGreeting = await waitGreeting('橙，', 'J3 控制组渲染');
      assertGreetingPrefix(controlGreeting, '橙，', '控制组 greetingText 以「橙，」开头');
      const p = await mp.currentPage();
      const d = await p.data();
      ctx.assertEqual(d.loggedIn, true, '已登录态（hero 分支渲染）');
    });

    // ── J4 反证选择器有效 + 采单行控制高度（这一步是防假绿的关键，不许省）
    await ctx.run('J4 反证选择器有效：.hero/.hi/.hi-sub 三个 rect 必须都拿到，并实测单行高度', async () => {
      const { rects, styles } = await measureScene();
      const probe = {
        hi: !!rects.hi,
        hiSub: !!rects.hiSub,
        hero: !!rects.hero,
        viewport: !!rects.viewport,
      };
      ctx.assertOk(
        probe.hi && probe.hiSub && probe.hero && probe.viewport,
        '四个 rect 全部命中（任一 null 即说明选择器/测量失效，后续断言全部不可信）',
        `probe=${JSON.stringify(probe)} rects=${JSON.stringify(rects)}`,
      );
      // 单行控制高度必须 > 0 且明显小于「两行」，否则拿它当行高基准没有意义
      lineHeight = rects.hi.height;
      ctx.assertOk(
        lineHeight > 0,
        '单行控制高度 > 0（短昵称只有 1 行）',
        `hi.height=${lineHeight} greeting=${JSON.stringify(controlGreeting)}`,
      );
      // 把「line-height 取不到 px」这件事留在证据里：它解释了为什么用实测控制组而不是 computedStyle
      ctx.assertOk(
        styles.fontSize > 0,
        '.hi 计算 font-size 可解析为 px（估算文本宽用）',
        `lineHeightStyle=${JSON.stringify(styles.lineHeightStyle)} fontSizeRaw=${
          styles.fontSize
        } letterSpacing=${styles.letterSpacing} clamp=${JSON.stringify(styles.clamp)}`,
      );
    });

    // ── J5 换 16 汉字昵称 → data 层：昵称不得被截断
    await ctx.run('J5 16 汉字昵称：greetingText 以 16 字 + 中文逗号开头（未截断）', async () => {
      const greeting = await renderWithNickname(CN16, CN16 + '，', 'J5 16 汉字渲染');
      assertGreetingPrefix(greeting, CN16 + '，', 'greetingText 前 17 字必须是「16 汉字 + 全角逗号」');
      const nick = greeting.split('，')[0];
      ctx.assertEqual(nick, CN16, 'greetingText 里的昵称部分（16 簇正好等于上限，不应被截断）');
      ctx.assertEqual(splitClusters(nick).length, 16, '昵称字素簇数 = 16');
    });

    // ── J6 布局层（本用例核心）：四条真实测量判据
    await ctx.run('J6 16 汉字昵称：hero 不挤出/不压副标题/≤2 行/不裁切', async () => {
      const greeting = await ctx.pageData(mp, 'greetingText');
      const { rects, styles } = await measureScene();
      const problems = heroLayoutProblems({
        hi: rects.hi,
        hiSub: rects.hiSub,
        hero: rects.hero,
        viewport: rects.viewport,
        lineHeight,
        clamp: styles.clamp,
        fontSize: styles.fontSize,
        letterSpacing: styles.letterSpacing,
        text: greeting,
      });
      ctx.assertOk(problems.length === 0, '16 汉字昵称下 hero 布局四项全过', `problems=${JSON.stringify(problems)}`);
    });

    // ── J7 emoji 昵称：同一组布局判据 + 字形完整性（无孤立代理项 / 无替换字符）
    await ctx.run('J7 16 emoji 昵称：同一组布局判据 + 无半截字形', async () => {
      const greeting = await renderWithNickname(EMOJI16, EMOJI16 + '，', 'J7 16 emoji 渲染');
      assertGreetingPrefix(greeting, EMOJI16 + '，', 'greetingText 前缀是完整 16 簇 emoji（簇边界未被切开）');
      const nick = greeting.split('，')[0];
      ctx.assertEqual(splitClusters(nick).length, 16, 'emoji 昵称字素簇数 = 16');
      // 孤立代理项 = 半个 emoji / 半面旗帜（解码碎了才会出现）
      const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
      ctx.assertOk(
        !LONE_SURROGATE.test(greeting),
        'greetingText 无孤立代理项（无半个 emoji/半面旗帜）',
        `greeting=${JSON.stringify(greeting)}`,
      );
      // U+FFFD = 编码不认识的替换字符，真机上渲染成方块乱码
      ctx.assertOk(
        greeting.indexOf('\uFFFD') === -1,
        'greetingText 无 U+FFFD 替换字符（方块乱码形态）',
        `greeting=${JSON.stringify(greeting)}`,
      );

      const { rects, styles } = await measureScene();
      const problems = heroLayoutProblems({
        hi: rects.hi,
        hiSub: rects.hiSub,
        hero: rects.hero,
        viewport: rects.viewport,
        lineHeight,
        clamp: styles.clamp,
        fontSize: styles.fontSize,
        letterSpacing: styles.letterSpacing,
        text: greeting,
      });
      ctx.assertOk(problems.length === 0, '16 emoji 昵称下 hero 布局四项全过', `problems=${JSON.stringify(problems)}`);
    });

    // ── J8 清场：按 J1 快照恢复五个 key（空值 → 移除，与 G 用例同口径）
    await ctx.run('J8 清场：按快照恢复五个 key 原值', async () => {
      for (const alias of SNAPSHOT_ALIASES) {
        const original = snapshot[alias];
        if (original === '' || original === undefined || original === null) {
          await ctx.removeStorage(mp, ctx.KEYS[alias]);
        } else {
          await ctx.setStorage(mp, ctx.KEYS[alias], original);
        }
      }
      const redact = (v, alias) => (alias === 'token' || alias === 'refreshToken' ? (v ? '<set>' : '<empty>') : JSON.stringify(v));
      for (const alias of SNAPSHOT_ALIASES) {
        const now = await ctx.getStorage(mp, ctx.KEYS[alias]);
        // token 是真实凭据：只比较是否恢复、不把值打进日志
        const ok = (now || '') === (snapshot[alias] || '');
        ctx.assertOk(ok, `${alias} 已恢复原值`, `restored=${redact(now, alias)}`);
      }
    });
  },
};

/** 暴露纯函数给将来的单测/复用（当前用例内自足，不额外依赖） */
module.exports._internal = { splitClusters, estimateTextWidth, parsePx, heroLayoutProblems, CN16, EMOJI16 };
