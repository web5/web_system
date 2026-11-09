<script setup lang="ts">
/**
 * 新概念英语 · PC portal「发现」阅读页
 *
 * 设计判断（真源：20-私域资产/新概念英语学习/阅读体验设计判断.md）：
 * 并排双语会让眼睛自动滑向中文、跳过英文解码，训练失效。
 * 所以正文默认纯英文，中文「求助要有代价但代价很小」——点句才出，不打断阅读。
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  getNceMeta,
  listNceLessons,
  getNceLesson,
  type NceMeta,
  type NceLessonSummary,
  type NceLessonDetail,
  type NceWord,
} from '@/api/nce';

/** 册别切换：与后端 BOOKS 配置表一致（docs/development/reports/2026-11-09-NCE多册支持方案.md §2.1）。 */
const BOOKS = [
  { key: 'NCE2', label: '第二册' },
  { key: 'NCE3', label: '第三册' },
  { key: 'NCE4', label: '第四册' },
];
const activeBook = ref('NCE2');

type Mode = 'immersion' | 'tap' | 'bilingual';
interface Token { text: string; word?: NceWord }
interface Group { label: string; items: NceLessonSummary[] }

const route = useRoute();
const router = useRouter();

const meta = ref<NceMeta | null>(null);
const lessons = ref<NceLessonSummary[]>([]);
const detail = ref<NceLessonDetail | null>(null);
const loading = ref(false);
const errorMsg = ref('');
const activeId = ref(1);
const keyword = ref('');

const mode = ref<Mode>((localStorage.getItem('nce-mode') as Mode) || 'immersion');
const fontStep = ref(Number(localStorage.getItem('nce-font') || '1'));
const revealed = ref<number[]>([]);
// 🔴 译文显隐只由「点击」驱动，不挂 hover：触摸设备会合成 mouseenter/mouseleave，
//    导致点按档第二次点同一句收不回去（2026-11-05 移动端反馈）。
const showTranslation = ref(false);
const exOpen = ref(false);
const sheetOpen = ref(false);
const answers = ref<Record<number, number>>({});
const wordPopup = ref<NceWord | null>(null);
const readIds = ref<number[]>(JSON.parse(localStorage.getItem('nce-read') || '[]'));

const letters = 'ABCD';
const modeLabels: { key: Mode; label: string }[] = [
  { key: 'immersion', label: '沉浸' },
  { key: 'tap', label: '点按' },
  { key: 'bilingual', label: '对照' },
];

const groups = computed<Group[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  const list = lessons.value.filter((l) =>
    !kw ||
    String(l.id).includes(kw) ||
    (l.title || '').toLowerCase().includes(kw) ||
    (l.titleCn || '').includes(kw),
  );
  const out: Group[] = [];
  const max = meta.value?.total ?? 96;
  for (let s = 1; s <= max; s += 24) {
    const items = list.filter((l) => l.id >= s && l.id < s + 24);
    if (items.length) out.push({ label: `Lesson ${s}–${s + 23}`, items });
  }
  return out;
});

function setMode(m: Mode) {
  mode.value = m;
  localStorage.setItem('nce-mode', m);
  revealed.value = [];
}
function setFont(step: number) {
  fontStep.value = step;
  localStorage.setItem('nce-font', String(step));
}
function cnVisible(i: number): boolean {
  return mode.value === 'bilingual' || revealed.value.includes(i);
}
function toggleReveal(i: number) {
  if (mode.value === 'bilingual') return;
  wordPopup.value = null; // 点句子即收起查词卡，卡不再悬在正文上吞点击
  revealed.value = revealed.value.includes(i)
    ? revealed.value.filter((x) => x !== i)
    : [...revealed.value, i];
}
/** 点生词 = 查词 + 同时揭示该句译文。
 *  触摸端手指常落在生词上，若只弹查词卡，用户会以为「点按翻译没反应」。 */
function onWord(w: NceWord, i: number) {
  wordPopup.value = w;
  if (mode.value !== 'bilingual' && !revealed.value.includes(i)) {
    revealed.value = [...revealed.value, i];
  }
}

/** 不用 v-html：把句子切成 token 数组交给模板渲染，天然免疫 XSS。
 *  \b 词边界足够，刻意不用正则 lookbehind（旧 Safari 不支持会白屏）。 */
function tokensOf(s: string): Token[] {
  const ws = detail.value?.words ?? [];
  const map = new Map<string, NceWord>();
  for (const w of ws) if (w.word) map.set(w.word.toLowerCase(), w);
  const names = ws
    .map((w) => w.word)
    .filter((w): w is string => !!w)
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!names.length) return [{ text: s }];
  const re = new RegExp('\\b(' + names.join('|') + ')\\b', 'gi');
  return s.split(re).filter(Boolean).map((part) => {
    const w = map.get(part.toLowerCase());
    return w ? { text: part, word: w } : { text: part };
  });
}

function leadZh(): string { return detail.value?.leadQuestionCn ?? ''; }
function leadEn(): string { return detail.value?.leadQuestion ?? ''; }

async function openLesson(id: number) {
  activeId.value = id;
  revealed.value = [];
  showTranslation.value = false;
  exOpen.value = false;
  sheetOpen.value = false;
  answers.value = {};
  wordPopup.value = null;
  errorMsg.value = '';
  void router.replace({ path: '/nce', query: { id: String(id) } });
  loading.value = true;
  try {
    detail.value = await getNceLesson(id, activeBook.value);
    if (!readIds.value.includes(id)) {
      readIds.value = [...readIds.value, id];
      localStorage.setItem('nce-read', JSON.stringify(readIds.value));
    }
  } catch {
    errorMsg.value = '课文加载失败，请稍后重试';
    detail.value = null;
  } finally {
    loading.value = false;
  }
}

function choose(qi: number, oi: number) {
  answers.value = { ...answers.value, [qi]: oi };
}

async function onBookChange(k: string) {
  activeBook.value = k;
  errorMsg.value = '';
  try {
    const [m, list] = await Promise.all([
      getNceMeta(k),
      listNceLessons({ page: 1, pageSize: 100, book: k }),
    ]);
    meta.value = m;
    lessons.value = list.items ?? [];
  } catch {
    errorMsg.value = '课文目录加载失败，请稍后重试';
    return;
  }
  await openLesson(lessons.value[0]?.id ?? 1);
}

onMounted(async () => {
  try {
    const [m, list] = await Promise.all([
      getNceMeta(activeBook.value),
      listNceLessons({ page: 1, pageSize: 100, book: activeBook.value }),
    ]);
    meta.value = m;
    lessons.value = list.items ?? [];
  } catch {
    errorMsg.value = '课文目录加载失败，请稍后重试';
    return;
  }
  const q = Number(route.query.id);
  await openLesson(Number.isInteger(q) && q > 0 ? q : (lessons.value[0]?.id ?? 1));
});
</script>

<template>
  <div class="nce" :style="{ '--font-step': fontStep }">
    <!-- 工具条：窄屏单行横滚，不占阅读高度 -->
    <div class="bar">
      <div class="brand">新概念英语 <span v-if="meta" class="sub">{{ meta.downloaded }}/{{ meta.total }} 课</span></div>
      <div class="seg book">
        <button v-for="b in BOOKS" :key="b.key" type="button"
          :class="{ on: activeBook === b.key }" @click="onBookChange(b.key)">{{ b.label }}</button>
      </div>
      <div class="spacer" />
      <div class="seg">
        <button v-for="m in modeLabels" :key="m.key" type="button"
          :class="{ on: mode === m.key }" @click="setMode(m.key)">{{ m.label }}</button>
      </div>
      <div class="seg font">
        <button v-for="s in [0, 1, 2]" :key="s" type="button"
          :class="{ on: fontStep === s }" @click="setFont(s)">{{ ['A', 'A', 'A'][s] }}</button>
      </div>
      <input v-model="keyword" class="search" type="search" placeholder="搜课号 / 标题" />
    </div>

    <div class="layout">
      <!-- 左：目录 -->
      <aside class="toc">
        <div v-for="g in groups" :key="g.label" class="grp">
          <div class="grp-t">{{ g.label }}</div>
          <button v-for="l in g.items" :key="l.id" type="button" class="toc-item"
            :class="{ on: l.id === activeId }" @click="openLesson(l.id)">
            <span class="num">{{ String(l.id).padStart(2, '0') }}</span>
            <span class="tt">{{ l.title }}</span>
            <span v-if="readIds.includes(l.id)" class="read" aria-label="已读">✓</span>
          </button>
        </div>
        <div v-if="!groups.length" class="empty">没有匹配的课文</div>
      </aside>

      <!-- 中：文章（默认纯英文） -->
      <article class="article">
        <div v-if="loading" class="state">加载中…</div>
        <div v-else-if="errorMsg" class="state err">{{ errorMsg }}</div>
        <template v-else-if="detail">
          <header class="art-head">
            <div class="lno">Lesson {{ String(detail.id).padStart(2, '0') }}</div>
            <h1>{{ detail.title }}</h1>
            <div v-if="detail.titleCn" class="title-cn">{{ detail.titleCn }}</div>
            <div v-if="leadZh() || leadEn()" class="lead">
              <div class="lead-zh">{{ leadZh() || leadEn() }}</div>
              <div v-if="leadZh() && leadEn()" class="lead-en">{{ leadEn() }}</div>
            </div>
            <div class="src-tag" :class="detail.textSource">
              {{ detail.textSource === 'xdf' ? '权威全文' : '字幕拼接版' }}
            </div>
          </header>

          <div class="sentences">
            <p v-if="mode === 'tap'" class="tap-hint">轻点任意句子看中文，再点一次收起 · 点带虚线的生词查词</p>
            <div v-for="(l, i) in detail.lines" :key="i" class="sent"
              :class="{ tappable: mode === 'tap', bilingual: mode === 'bilingual' }"
              :aria-expanded="cnVisible(i)" @click="toggleReveal(i)">
              <div class="en"><template v-for="(t, j) in tokensOf(l.en)" :key="j"><span
                v-if="t.word" class="w" role="button" tabindex="0"
                @click.stop="onWord(t.word!, i)"
                @keydown.enter.stop="onWord(t.word!, i)">{{ t.text }}</span><span
                v-else>{{ t.text }}</span></template></div>
              <transition name="fade"><div v-if="cnVisible(i) && l.cn" class="cn">{{ l.cn }}</div></transition>
            </div>
          </div>

          <section class="trans">
            <button type="button" class="link" @click="showTranslation = !showTranslation">
              {{ showTranslation ? '收起参考译文' : '查看参考译文' }}
            </button>
            <div v-if="showTranslation" class="trans-body">{{ detail.translation }}</div>
          </section>

          <div v-if="wordPopup" class="word-card" role="dialog">
            <button type="button" class="close" @click="wordPopup = null">×</button>
            <div class="wd">{{ wordPopup.word }} <span class="ph">{{ wordPopup.phonetic }}</span></div>
            <div class="df">{{ wordPopup.pos }} {{ wordPopup.def }}</div>
            <div v-if="wordPopup.example" class="eg">{{ wordPopup.example }}</div>
          </div>
        </template>
        <div v-else class="state">暂无课文数据</div>
      </article>

      <!-- 右：习题（读完再展开） -->
      <aside class="exercise" :class="{ open: sheetOpen }">
        <div class="ex-head">
          <h3>习题</h3>
          <button type="button" class="close-sheet" @click="sheetOpen = false">×</button>
        </div>
        <template v-if="detail">
          <div v-if="!exOpen" class="ex-gate">
            <p>先读完课文，再开始练习。</p>
            <button type="button" class="btn" @click="exOpen = true">开始练习（{{ detail.exercises.length }} 题）</button>
          </div>
          <div v-else class="ex-list">
            <div v-for="(q, qi) in detail.exercises" :key="qi" class="quiz">
              <div class="q">{{ qi + 1 }}. {{ q.q }}</div>
              <button v-for="(o, oi) in q.options" :key="oi" type="button" class="opt"
                :class="{
                  right: answers[qi] !== undefined && oi === q.answer,
                  wrong: answers[qi] === oi && oi !== q.answer,
                }"
                @click="choose(qi, oi)">
                {{ letters[oi] ?? oi }}. {{ o }}
              </button>
              <div v-if="answers[qi] !== undefined" class="exp"
                :class="{ ok: answers[qi] === q.answer }">
                {{ answers[qi] === q.answer ? '正确' : '再想想' }} · {{ q.exp }}
              </div>
            </div>
          </div>
        </template>
      </aside>
    </div>

    <button type="button" class="ex-fab" @click="sheetOpen = true">习题</button>
    <div v-if="sheetOpen" class="scrim" @click="sheetOpen = false" />
  </div>
</template>

<style scoped>
.nce {
  --bg: #FFFFFF; --card: #FFFFFF; --text: #1A1A1F; --text-2: #6B7280;
  --brand: #F97316; --accent: #0EA5A4; --line: rgba(0, 0, 0, .08);
  height: 100%; min-height: 0; display: flex; flex-direction: column;
  background: var(--bg); color: var(--text);
}
.bar {
  display: flex; align-items: center; gap: 10px; flex: 0 0 auto;
  padding: 8px 14px; border-bottom: 1px solid var(--line); overflow-x: auto; white-space: nowrap;
  -webkit-overflow-scrolling: touch;
}
/* 🔴 窄屏禁止 flex 压缩：默认 flex-shrink:1 会把 .seg 盒子压得比内部按钮还窄，
   按钮溢出盒子与后面的字号档重叠，导致「对照」按钮被盖住、触摸点不到（390px 实测）。
   放不下就整条横滚，绝不让可点控件互相压盖。 */
.bar > * { flex: 0 0 auto; }
.bar > .spacer { flex: 1 1 auto; min-width: 0; }
.brand { font-weight: 600; font-size: 14px; }
.sub { color: var(--text-2); font-weight: 400; font-size: 12px; margin-left: 4px; }
.spacer { flex: 1 1 auto; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.seg button { border: 0; background: #fff; color: var(--text-2); padding: 4px 10px; font-size: 12px; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--line); }
.seg button.on { background: var(--brand); color: #fff; }
.seg.font button:nth-child(1) { font-size: 11px; }
.seg.font button:nth-child(3) { font-size: 15px; }
.search { width: 150px; border: 1px solid var(--line); border-radius: 8px; padding: 5px 9px; font-size: 12px; outline: none; }
.search:focus { border-color: var(--accent); }

.layout { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 240px minmax(0, 1fr) 300px; }
.toc, .exercise { overflow-y: auto; border-right: 1px solid var(--line); padding: 12px; }
.exercise { border-right: 0; border-left: 1px solid var(--line); }
.grp { margin-bottom: 14px; }
.grp-t { font-size: 11px; color: var(--text-2); letter-spacing: .06em; padding: 4px 6px; }
.toc-item { display: flex; align-items: baseline; gap: 7px; width: 100%; text-align: left; border: 0; background: transparent; padding: 6px 8px; border-radius: 6px; cursor: pointer; color: var(--text); font-size: 12px; }
.toc-item:hover { background: #F9FAFB; }
.toc-item.on { background: #FFF7ED; color: var(--brand); font-weight: 600; }
.num { color: var(--accent); font-variant-numeric: tabular-nums; flex: 0 0 20px; }
.tt { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.read { color: var(--accent); }
.empty, .state { color: var(--text-2); font-size: 13px; padding: 24px 8px; text-align: center; }
.state.err { color: #DC2626; }

.article { overflow-y: auto; padding: 26px max(24px, calc((100% - 68ch) / 2)) 80px; position: relative; }
.art-head { margin-bottom: 22px; }
.lno { font-size: 12px; color: var(--accent); letter-spacing: .08em; }
.art-head h1 { font-family: Georgia, 'Songti SC', serif; font-size: calc(26px + var(--font-step) * 2px); margin: 6px 0 2px; line-height: 1.25; }
.title-cn { color: var(--text-2); font-size: 14px; }
.lead { margin-top: 14px; padding: 10px 14px; background: #FFF7ED; border-left: 3px solid var(--brand); border-radius: 0 6px 6px 0; }
.lead-zh { font-size: 14px; font-weight: 600; }
.lead-en { color: var(--text-2); font-size: 12px; margin-top: 3px; font-family: Georgia, serif; }
.src-tag { display: inline-block; margin-top: 10px; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #ECFDF5; color: #047857; }
.src-tag.lrc { background: #FFF7ED; color: #B45309; }
.sentences { font-family: Georgia, 'Songti SC', serif; max-width: 68ch; }
.tap-hint { font-family: -apple-system, 'PingFang SC', sans-serif; font-size: 12px; line-height: 1.6; color: #0F766E; background: #ECFDF9; border-left: 2px solid var(--accent); border-radius: 0 6px 6px 0; padding: 8px 11px; margin: 0 0 14px; }
.sent { padding: 7px 8px; border-radius: 6px; cursor: pointer; line-height: 1.85; touch-action: manipulation; -webkit-tap-highlight-color: rgba(14,165,164,.12); }
@media (hover: hover) { .sent:hover { background: #FAFAFA; } }
.sent:active { background: #FAFAFA; }
.sent.tappable { border-bottom: 1px dashed rgba(0,0,0,.10); }
.sent.bilingual { cursor: default; }
.en { font-size: calc(16px + var(--font-step) * 1.5px); }
.cn { color: var(--text-2); font-family: -apple-system, 'PingFang SC', sans-serif; font-size: 13px; margin-top: 3px; padding-left: 10px; border-left: 2px solid var(--accent); }
.w { color: var(--accent); border-bottom: 1px dashed var(--accent); cursor: pointer; }
.fade-enter-active, .fade-leave-active { transition: opacity .15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.trans { margin-top: 26px; border-top: 1px solid var(--line); padding-top: 14px; max-width: 68ch; }
.link { border: 0; background: none; color: var(--brand); font-size: 13px; cursor: pointer; padding: 0; }
.trans-body { white-space: pre-wrap; font-size: 14px; line-height: 1.9; color: #374151; margin-top: 10px; }
/* 查词卡是纯展示卡：正文点句要能穿透它，否则窄屏底部整条都是死区 */
.word-card { position: sticky; bottom: 12px; margin-top: 18px; background: #fff; border: 1px solid var(--line); box-shadow: 0 4px 16px rgba(0,0,0,.08); border-radius: 10px; padding: 12px 16px; max-width: 68ch; pointer-events: none; }
.word-card .close { float: right; border: 0; background: none; font-size: 18px; cursor: pointer; color: var(--text-2); pointer-events: auto; }
.wd { font-family: Georgia, serif; font-size: 16px; font-weight: 600; }
.ph, .df, .eg { color: var(--text-2); font-size: 12px; margin-top: 3px; }

.ex-head { display: flex; align-items: center; justify-content: space-between; }
.ex-head h3 { margin: 0 0 10px; font-size: 15px; }
.close-sheet { display: none; border: 0; background: none; font-size: 20px; cursor: pointer; }
.ex-gate p { color: var(--text-2); font-size: 13px; line-height: 1.7; }
.btn { border: 0; background: var(--brand); color: #fff; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
.quiz { padding: 12px 0; border-bottom: 1px dashed var(--line); }
.q { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.opt { display: block; width: 100%; text-align: left; border: 1px solid var(--line); background: #fff; border-radius: 6px; padding: 7px 10px; margin-bottom: 6px; font-size: 12px; cursor: pointer; color: var(--text); }
.opt:hover { border-color: var(--accent); }
.opt.right { border-color: var(--accent); background: #F0FDFA; color: #0F766E; }
.opt.wrong { border-color: #DC2626; background: #FEF2F2; }
.exp { font-size: 12px; color: #B45309; margin-top: 4px; }
.exp.ok { color: #0F766E; }
.ex-fab, .scrim { display: none; }

@media (max-width: 899px) {
  .bar { padding: 7px 10px; gap: 7px; }
  .brand { font-size: 12px; }
  .brand .sub { display: none; }
  .search { width: 108px; }
  .layout { display: block; overflow-y: auto; }
  .toc { display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden; border-right: 0; border-bottom: 1px solid var(--line); padding: 8px 10px; white-space: nowrap; }
  .grp { display: flex; gap: 6px; margin: 0; }
  .grp-t { display: none; }
  .toc-item { width: auto; flex: 0 0 auto; border: 1px solid var(--line); padding: 5px 9px; }
  .tt { max-width: 120px; }
  .article { padding: 18px 18px 96px; overflow: visible; }
  .exercise { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; max-height: 52vh; overflow-y: auto; background: #fff; border: 0; border-radius: 16px 16px 0 0; box-shadow: 0 -6px 24px rgba(0,0,0,.12); transform: translateY(101%); transition: transform .25s cubic-bezier(.22,.8,.3,1); padding: 14px 18px calc(20px + env(safe-area-inset-bottom)); }
  .exercise.open { transform: translateY(0); }
  .close-sheet { display: block; }
  .ex-fab { display: block; position: fixed; right: 16px; bottom: calc(18px + env(safe-area-inset-bottom)); z-index: 25; border: 0; background: var(--brand); color: #fff; border-radius: 24px; padding: 10px 20px; font-size: 13px; box-shadow: 0 3px 12px rgba(249,115,22,.35); }
  .scrim { display: block; position: fixed; inset: 0; z-index: 20; background: rgba(0,0,0,.28); }
  /* 查词卡固定到习题按钮上方，用户点完生词立刻看得见；卡体不吃点击 */
  .word-card { position: fixed; left: 12px; right: 12px; bottom: calc(76px + env(safe-area-inset-bottom)); z-index: 26; margin: 0; max-width: 520px; }
  .sent { min-height: 44px; }
}
</style>
