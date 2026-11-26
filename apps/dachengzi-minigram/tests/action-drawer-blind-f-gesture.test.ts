/**
 * 🔵 RD 独立盲测 F 组：公共抽屉组件（components/action-drawer）行为反例
 *
 * 判据：
 *  - AC-B.5/6：word=4 项 / line=2 项，顺序固定（换档重算）
 *  - 契约 1：组件**不自己关**（遮罩/下滑/✕ 只 triggerEvent('close')，visible 由页面改）
 *  - 契约 2：busy 锁 300ms 防连点
 *  - D4/V-B9：下滑 ≥48rpx 关、<48rpx 回弹、上滑不位移
 *  - BB6：下滑手势起点在**按钮上**时应不响应拖拽（避免「想点按却把抽屉拖走」）
 *  - K9/§5.3：pageLifetimes.hide 必须把组件局部态（swipeY/busy/pressedKey/_hasStart）归零
 *  - E4：按下高亮 = pressedKey（反馈，不是静态暗示）
 */
/// <reference types="node" />
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';

jest.mock('../utils/line-actions', () => jest.requireActual('../utils/line-actions'));

const wxMock: any = {
  getSystemInfoSync: jest.fn(() => ({ windowWidth: 375 })),
};

/**
 * tts 桩：变体 C（2026-11-26 用户拍板）后组件内直接调 `speakText / stopSpeak / onSpeakState`，
 * 这里只记调用、推状态，不碰网络（组件单测不该走 services/tts 的真实现）。
 */
const mockTts: any = {
  listeners: new Set<(s: any) => void>(),
  calls: [] as string[],
};
jest.mock('../services/tts', () => ({
  speakText: (t: string) => { mockTts.calls.push(`speak:${t}`); return Promise.resolve(true); },
  stopSpeak: () => { mockTts.calls.push('stop'); },
  onSpeakState: (cb: (s: any) => void) => {
    mockTts.listeners.add(cb);
    return () => { mockTts.listeners.delete(cb); };
  },
}));

let cfg: any = null;

beforeAll(() => {
  (globalThis as any).wx = wxMock;
  (globalThis as any).Component = jest.fn((c: any) => { cfg = c; });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../components/action-drawer/index');
});

beforeEach(() => {
  wxMock.getSystemInfoSync.mockReturnValue({ windowWidth: 375 });
  mockTts.listeners.clear();
  mockTts.calls = [];
});

/** 造一个组件实例：properties 走 data，methods 互为兄弟 */
function makeInst(props: Record<string, unknown> = {}) {
  const inst: any = {
    data: {
      ...JSON.parse(JSON.stringify(cfg.data)),
      visible: true,
      scope: '',
      lineText: '',
      lineIndex: -1,
      word: '',
      wordHasDef: false,
      phonetic: '',
      ...props,
    },
    triggerEvent: jest.fn(),
    setData: jest.fn(function (this: any, patch: Record<string, unknown>) {
      Object.assign(this.data, patch);
    }),
  };
  for (const [k, v] of Object.entries(cfg.methods || {})) {
    inst[k] = (v as Function).bind(inst);
  }
  return inst;
}

const touch = (y: number) => ({ touches: [{ clientY: y }] });

describe('F1 换档重算动作集合（AC-B.5/6/7）', () => {
  it('attached 时按 scope 初始化 acts（word=4 / line=2）', () => {
    const w = makeInst({ scope: 'word' });
    cfg.lifetimes.attached.call(w);
    expect(w.data.acts.map((a: any) => a.label)).toEqual(['朗读此句', '收藏此句', '朗读单词', '收藏单词']);

    const l = makeInst({ scope: 'line' });
    cfg.lifetimes.attached.call(l);
    expect(l.data.acts.map((a: any) => a.label)).toEqual(['朗读此句', '收藏此句']);
  });

  it('scope 从 line 换到 word → 立刻变成 4 项且顺序固定', () => {
    const inst = makeInst({ scope: 'line' });
    cfg.lifetimes.attached.call(inst);
    inst.data.scope = 'word';
    cfg.observers.scope.call(inst, 'word');
    expect(inst.data.acts).toHaveLength(4);
    expect(inst.data.acts[2].label).toBe('朗读单词');
  });

  it('反例：非法 scope → 回落两项（不得渲染 0 个动作的空抽屉）', () => {
    const inst = makeInst({ scope: 'weird' });
    cfg.observers.scope.call(inst, 'weird');
    expect(inst.data.acts).toHaveLength(2);
  });
});

describe('F2 事件契约（组件只抛信号，不碰业务）', () => {
  it('两个收藏动作分别抛 collect-line / collect-word，payload 正确', () => {
    const inst = makeInst({ scope: 'word', lineIndex: 2, lineText: 'Stay in bed.', word: 'bed', wordHasDef: false });
    cfg.lifetimes.attached.call(inst);
    // busy 锁会挡连点：每次点前手动解锁，等价于 300ms 已过
    const tap = (key: string) => {
      inst.data.busy = false;
      inst.onActionTap({ currentTarget: { dataset: { key } } });
    };

    tap('collect-line');
    expect(inst.triggerEvent).toHaveBeenLastCalledWith('collect-line', { lineIndex: 2, text: 'Stay in bed.' });

    tap('collect-word');
    expect(inst.triggerEvent).toHaveBeenLastCalledWith('collect-word', { word: 'bed', lineIndex: 2, hasDef: false });
  });

  /**
   * 🔵 2026-11-26 变体 C（用户拍板）：朗读下沉到组件 ——
   * `speak-line` / `speak-word` **不再是"抛给页面的事件"**，而是组件内直接 `speakText`，
   * 且抽屉不关（用户要在抽屉里点 ■ 停止）。本用例把这条与收藏反向钉住：
   * 谁把朗读改回 triggerEvent，这里立刻红。
   */
  it('两个朗读动作**不抛事件**，改为组件内直接 speakText（抽屉不关）', () => {
    const inst = makeInst({ scope: 'word', lineIndex: 2, lineText: 'Stay in bed.', word: 'bed', wordHasDef: false });
    cfg.lifetimes.attached.call(inst);
    const tap = (key: string) => {
      inst.onActionTap({ currentTarget: { dataset: { key, kind: 'speak' } } });
    };

    tap('speak-line');
    expect(mockTts.calls).toContain('speak:Stay in bed.');   // 抽屉持有原文，直接朗读
    tap('speak-word');
    expect(mockTts.calls).toContain('speak:bed');

    expect(inst.triggerEvent).not.toHaveBeenCalled();        // 一个事件都不许抛
    expect(inst.data.playingKey).toBe('speak-word');         // 同一时刻只有最后一个在播
  });

  it('collect-word 的 hasDef 透传（普通词也必须原样回传，页面据此写 meta）', () => {
    const inst = makeInst({ scope: 'word', word: 'early', wordHasDef: true });
    inst.onActionTap({ currentTarget: { dataset: { key: 'collect-word' } } });
    expect(inst.triggerEvent).toHaveBeenCalledWith('collect-word', expect.objectContaining({ hasDef: true }));
  });

  it('遮罩 / ✕ 只抛 close（via 区分），组件**不自己**改 visible', () => {
    const inst = makeInst();
    inst.onMaskTap();
    expect(inst.triggerEvent).toHaveBeenLastCalledWith('close', { via: 'mask' });
    inst.onCloseTap();
    expect(inst.triggerEvent).toHaveBeenLastCalledWith('close', { via: 'close' });
    expect(inst.data).not.toHaveProperty('visible', false);
    expect(inst.setData).not.toHaveBeenCalledWith(expect.objectContaining({ visible: false }));
  });

  it('反例：未知 key / 空 key 不得抛任何事件', () => {
    const inst = makeInst({ scope: 'word' });
    inst.onActionTap({ currentTarget: { dataset: { key: 'nuke' } } });
    inst.onActionTap({ currentTarget: { dataset: {} } });
    inst.onActionTap({ currentTarget: {} } as any);
    expect(inst.triggerEvent).not.toHaveBeenCalled();
  });
});

describe('F3 busy 锁（防连点 · **只锁收藏**，朗读走 60ms 同帧防抖）', () => {
  it('300ms 内连点只生效一次', () => {
    jest.useFakeTimers();
    const inst = makeInst({ scope: 'word' });
    inst.onActionTap({ currentTarget: { dataset: { key: 'collect-line' } } });
    inst.onActionTap({ currentTarget: { dataset: { key: 'collect-word' } } });
    expect(inst.triggerEvent).toHaveBeenCalledTimes(1);
    expect(inst.data.pressedKey).toBe('collect-line'); // E4：按下高亮
    jest.advanceTimersByTime(300);
    expect(inst.data.busy).toBe(false);
    expect(inst.data.pressedKey).toBe('');
    jest.useRealTimers();
  });

  it('卸载后定时器到点不得 setData（_alive 守卫）', () => {
    jest.useFakeTimers();
    const inst = makeInst({ scope: 'word' });
    inst.onActionTap({ currentTarget: { dataset: { key: 'collect-line' } } });
    const calls = inst.setData.mock.calls.length;
    cfg.lifetimes.detached.call(inst);
    jest.advanceTimersByTime(500);
    expect(inst.setData.mock.calls.length).toBe(calls);
    jest.useRealTimers();
  });
});

describe('F4 下滑手势（V-B9 / D4）', () => {
  it('位移 ≥48rpx 松手 → 抛 close(via=swipe)', () => {
    const inst = makeInst();
    inst.onTouchStart(touch(100));
    inst.onTouchMove(touch(130)); // 30px ≈ 60rpx（375 屏）
    expect(inst.data.swipeY).toBe(30);
    inst.onTouchEnd();
    expect(inst.triggerEvent).toHaveBeenLastCalledWith('close', { via: 'swipe' });
  });

  it('位移 <48rpx 松手 → 回弹（swipeY=0），不关', () => {
    const inst = makeInst();
    inst.onTouchStart(touch(100));
    inst.onTouchMove(touch(110)); // 10px = 20rpx < 48
    inst.onTouchEnd();
    expect(inst.data.swipeY).toBe(0);
    expect(inst.triggerEvent).not.toHaveBeenCalled();
  });

  it('上滑不产生位移（抽屉不得被拖出屏顶）', () => {
    const inst = makeInst();
    inst.onTouchStart(touch(300));
    inst.onTouchMove(touch(100));
    expect(inst.data.swipeY).toBe(0);
  });

  it('windowWidth 异常（0 / NaN）→ 阈值换算不产生 NaN（否则永远关不掉）', () => {
    wxMock.getSystemInfoSync.mockReturnValue({ windowWidth: 0 });
    const inst = makeInst();
    inst.onTouchStart(touch(100));
    inst.onTouchMove(touch(140)); // 40px，按 375 兜底折算 80rpx ≥ 48
    inst.onTouchEnd();
    expect(inst.triggerEvent).toHaveBeenLastCalledWith('close', { via: 'swipe' });

    wxMock.getSystemInfoSync.mockReturnValue({ windowWidth: NaN });
    const inst2 = makeInst();
    inst2.onTouchStart(touch(100));
    inst2.onTouchMove(touch(140));
    inst2.onTouchEnd();
    expect(inst2.triggerEvent).toHaveBeenLastCalledWith('close', { via: 'swipe' });
  });

  it('反例 BB6：从动作按钮上按下并下拉 → 不应把抽屉拖走（按钮区不参与拖拽）', () => {
    // 结构事实：touchstart/move/end 挂在 .ad-drawer 根节点，动作按钮是其子节点，
    // 触摸必然先经过根节点 → 起点在按钮上同样会进 onTouchStart。
    // 判据要求「按钮区域不响应拖拽」，故这里断言「从按钮按下 + 下拉 60rpx 不触发 close」。
    const wxml = fsMod.readFileSync(pathMod.join(__dirname, '../components/action-drawer/index.wxml'), 'utf8');
    const actsInsideDrawer = /class="ad-acts"[\s\S]*?catchtap="onActionTap"/.test(wxml);
    expect(actsInsideDrawer).toBe(true); // 按钮确实在抽屉内（无独立手势隔离层）
    const inst = makeInst();
    inst.onTouchStart(touch(600)); // 模拟手指落在动作按钮上
    inst.onTouchMove(touch(640));
    inst.onTouchEnd();
    expect(inst.triggerEvent).not.toHaveBeenCalledWith('close', expect.anything());
  });
});

describe('F5 K9：pageLifetimes.hide 归零组件局部态', () => {
  it('hide → swipeY / dragging / busy / pressedKey / playingKey / _hasStart 全部归零，busy 定时器清掉', () => {
    jest.useFakeTimers();
    const inst = makeInst({ scope: 'word' });
    inst.onActionTap({ currentTarget: { dataset: { key: 'collect-line' } } });
    inst.onTouchStart(touch(100));
    inst.onTouchMove(touch(110));
    expect(inst.data.swipeY).toBe(10);
    expect(inst.data.busy).toBe(true);
    inst.setData({ playingKey: 'speak-word' });

    cfg.pageLifetimes.hide.call(inst);

    expect(inst.data.swipeY).toBe(0);
    expect(inst.data.dragging).toBe(false);
    expect(inst.data.busy).toBe(false);
    expect(inst.data.pressedKey).toBe('');
    expect(inst.data.playingKey).toBe('');   // 2026-11-26 变体 C：隐藏必须清播放态（并已 stopSpeak）
    expect(inst.data._hasStart).toBe(false);
    expect(inst.data._busyTimer).toBe(0);
    expect(mockTts.calls).toContain('stop');
    jest.useRealTimers();
  });

  it('visible 变 false 也走同一处归零（下次打开不残留上次的下滑位移）', () => {
    const inst = makeInst({ visible: true });
    inst.onTouchStart(touch(100));
    inst.onTouchMove(touch(110));
    inst.data.visible = false;
    cfg.observers.visible.call(inst, false);
    expect(inst.data.swipeY).toBe(0);
    expect(inst.data.dragging).toBe(false);
  });

  it('反例：visible 变 true 时不得清动作集合', () => {
    const inst = makeInst({ scope: 'word', visible: false });
    cfg.lifetimes.attached.call(inst);
    inst.data.visible = true;
    cfg.observers.visible.call(inst, true);
    expect(inst.data.acts).toHaveLength(4);
  });
});
