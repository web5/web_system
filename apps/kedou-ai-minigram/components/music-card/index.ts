/**
 * 歌曲推荐卡片（承载 SSE `card` 事件，kind=music）
 *
 * 数据来源：后端 present-music-card 工具产出、controller 转成 card 事件下发。
 * 一期不在小程序内播音频：能跳就跳音乐小程序，跳不了就复制链接 / 歌名，
 * 不报错、不假装有播放能力。
 *
 * ⚠️ 平台约束：wx.navigateToMiniProgram 必须由用户点击触发（基础库 2.3.0 起禁止自动跳转），
 *    故跳转只绑在按钮 tap 上，不在页面生命周期里调用。
 *
 * ## 渠道为什么要端上自选
 * 后端 card 带 `providers`（全量可用渠道）。渠道能不能用是**端**决定的：
 * - mini_program：本端唯一能真正跳过去的渠道（PC 跳不了）
 * - h5：PC 浏览器能开新页；小程序里 web-view 受业务域名限制打不开 → 退化成复制链接
 * 而后端给的单一 `provider` 是 resolveProvider 按 sort 取的最小值，很可能取到
 * 本端用不了的那一个（当前库里 h5 的 sort=10 < mini_program 的 100，小程序必拿 h5）。
 * 端上自选，服务端就不需要感知请求来自哪一端（ToolContext 里也没有端信息）。
 */
interface Song {
  title: string;
  artist?: string;
  reason?: string;
}

interface Provider {
  code: string;
  name: string;
  appId?: string | null;
  entryType: string;
  searchTemplate?: string | null;
  path?: string | null;
  ready: boolean;
}

/** 本端对渠道的处置方式：能跳 / 只能复制链接 / 只能复制歌名 */
type PlayMode = 'jump' | 'copy-link' | 'copy-name';

/** 把搜索模板里的 {keyword} 渲染出来；无模板返回空串（跳首页） */
function renderPath(p: Provider, keyword: string): string {
  if (!p.searchTemplate) return '';
  return p.searchTemplate.replace('{keyword}', encodeURIComponent(keyword || ''));
}

/** 按本端能力挑渠道：能跳 > 能复制链接 > 只能复制歌名 */
function pickProvider(
  list: Provider[],
  keyword: string,
): { mode: PlayMode; provider: Provider | null; url: string } {
  const safe = Array.isArray(list) ? list.filter(Boolean) : [];
  const jump = safe.find((p) => p.ready && p.entryType === 'mini_program' && p.appId);
  if (jump) return { mode: 'jump', provider: jump, url: renderPath(jump, keyword) };

  const link = safe.find((p) => p.ready && p.entryType === 'h5' && p.searchTemplate);
  if (link) return { mode: 'copy-link', provider: link, url: renderPath(link, keyword) };

  return { mode: 'copy-name', provider: safe[0] || null, url: '' };
}

Component({
  properties: {
    // value 的官方类型是 `IAnyObject | undefined`，null 不被接受；
    // 但「卡片未就绪」用 null 语义最准（空对象会被当成有效卡片），故显式放宽
    card: { type: Object, value: null as any },
  },

  data: {
    songs: [] as Song[],
    provider: null as Provider | null,
    keyword: '',
    btnText: '去听',
    /** 卡片底部说明：随「能不能跳」变化，避免按钮说「去听」、实际只复制的误导 */
    noteText: '',
    /** 当前处置方式，onPlay 据此分流 */
    mode: 'copy-name' as PlayMode,
    /** 降级时要复制的内容（搜索链接优先，否则歌名） */
    copyTarget: '',
  },

  observers: {
    card(val: any) {
      if (!val || val.kind !== 'music') return;
      const songs: Song[] = Array.isArray(val.songs) ? val.songs.slice(0, 3) : [];
      const keyword = String(val.keyword || (songs[0] && songs[0].title) || '');
      // 老历史（providers 字段上线前落库的）没有 providers，退回单一 provider 兼容
      const list: Provider[] =
        Array.isArray(val.providers) && val.providers.length ? val.providers : [val.provider].filter(Boolean);
      const { mode, provider, url } = pickProvider(list, keyword);
      const name = provider ? provider.name : '音乐 App';

      let btnText = '去听';
      let noteText = '';
      let copyTarget = keyword;
      if (mode === 'jump') {
        btnText = `去 ${name}听`;
        noteText = `跳转后在 ${name} 搜索并播放，本小程序不提供音频播放`;
      } else if (mode === 'copy-link') {
        btnText = '复制链接';
        copyTarget = url || keyword;
        noteText = `本小程序打不开 ${name} 网页，复制搜索链接后粘贴到浏览器打开`;
      } else {
        btnText = '复制歌名';
        noteText = `本小程序不提供播放，复制歌名后去 ${name} 搜索`;
      }

      this.setData({ songs, provider, keyword, mode, btnText, noteText, copyTarget });
    },
  },

  methods: {
    /** 主按钮：能跳则跳；不能跳（或跳转失败）都走降级，不静默 */
    onPlay() {
      const p = this.data.provider;
      if (this.data.mode === 'jump' && p && p.appId) {
        wx.navigateToMiniProgram({
          appId: p.appId,
          path: renderPath(p, this.data.keyword),
          envVersion: 'release',
          fail: () => this.copyFallback(),
        });
        return;
      }
      this.copyFallback();
    },

    /** 降级：复制搜索链接（有则优先，否则歌名），提示用户去哪儿用 */
    copyFallback() {
      const target = this.data.copyTarget || this.data.keyword;
      const isLink = /^https?:\/\//i.test(target);
      wx.setClipboardData({
        data: target,
        success: () => {
          wx.showToast({
            title: isLink ? '已复制链接，粘贴到浏览器打开' : `已复制「${target}」，去音乐 App 搜索`,
            icon: 'none',
          });
        },
      });
      this.triggerEvent('fallback');
    },

    /** 换一批 / 不感兴趣：交给页面当成一轮新的对话发出（Agent 侧会读口味档案） */
    onSwap() {
      this.triggerEvent('swap');
    },
    onDislike() {
      this.triggerEvent('dislike');
    },
  },
});
