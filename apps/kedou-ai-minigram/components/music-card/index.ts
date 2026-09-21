/**
 * 歌曲推荐卡片（承载 SSE `card` 事件，kind=music）
 *
 * 数据来源：后端 present-music-card 工具产出、controller 转成 card 事件下发。
 * 一期不在小程序内播音频：主按钮走 wx.navigateToMiniProgram 跳到配置好的音乐小程序；
 * 渠道未就绪（appid 仍为占位值）时降级为「复制歌名」，不报错、不假装有播放能力。
 *
 * ⚠️ 平台约束：wx.navigateToMiniProgram 必须由用户点击触发（基础库 2.3.0 起禁止自动跳转），
 *    故跳转只绑在按钮 tap 上，不在页面生命周期里调用。
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
  path?: string | null;
  ready: boolean;
}

Component({
  properties: {
    card: { type: Object, value: null },
  },

  data: {
    songs: [] as Song[],
    provider: null as Provider | null,
    keyword: '',
    btnText: '去听',
  },

  observers: {
    card(val: any) {
      if (!val || val.kind !== 'music') return;
      const songs: Song[] = Array.isArray(val.songs) ? val.songs.slice(0, 3) : [];
      const provider: Provider | null = val.provider || null;
      const keyword = String(val.keyword || (songs[0] && songs[0].title) || '');
      this.setData({
        songs,
        provider,
        keyword,
        btnText: provider ? `去 ${provider.name}听` : '去听',
      });
    },
  },

  methods: {
    /** 主按钮：跳转外部音乐小程序；不可用则复制歌名兜底 */
    onPlay() {
      const p = this.data.provider;
      const kw = this.data.keyword;
      if (p && p.ready && p.entryType === 'mini_program' && p.appId) {
        wx.navigateToMiniProgram({
          appId: p.appId,
          path: p.path || '',
          fail: () => this.copyKeyword(kw),
        });
        return;
      }
      this.copyKeyword(kw);
    },

    /** 降级：把歌名写进剪贴板，提示用户自行搜索 */
    copyKeyword(kw: string) {
      wx.setClipboardData({
        data: kw,
        success: () => {
          wx.showToast({ title: `已复制「${kw}」，去音乐 App 搜索`, icon: 'none' });
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
