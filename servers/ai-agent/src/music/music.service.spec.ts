import { MusicService } from './music.service';
import { MusicProvider } from './music-provider.entity';

/** 构造最小可用实体（isReady 只看这三个字段） */
function provider(p: Partial<MusicProvider>): MusicProvider {
  return p as MusicProvider;
}

describe('MusicService.isReady', () => {
  const svc = new MusicService({} as never, { get: () => '' } as never);

  it('h5 渠道：有搜索模板即可用（无需 appId）', () => {
    expect(
      svc.isReady(
        provider({ appId: null, entryType: 'h5', searchTemplate: 'https://y.qq.com/search?w={keyword}' }),
      ),
    ).toBe(true);
  });

  it('h5 渠道：无搜索模板则不可用（跳转首页无意义）', () => {
    expect(svc.isReady(provider({ appId: null, entryType: 'h5', searchTemplate: null }))).toBe(false);
  });

  it('小程序渠道：appId 占位（PENDING）视为未就绪', () => {
    expect(
      svc.isReady(provider({ appId: 'PENDING_QQ', entryType: 'mini_program', searchTemplate: null })),
    ).toBe(false);
  });

  it('小程序渠道：真实 appId 视为就绪', () => {
    expect(
      svc.isReady(provider({ appId: 'wx123456', entryType: 'mini_program', searchTemplate: null })),
    ).toBe(true);
  });
});
