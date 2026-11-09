/**
 * 微信新 API 类型补丁
 *
 * 背景：@types/wechat-miniprogram@3.4.10 滞后于基础库，项目在用的几个 API 官方包还没声明，
 * tsc 报 TS2551 / TS2339（wx.getWindowInfo、enableChunked、onChunkReceived、
 * createWebAudioContext）。这些都是**真实存在的基础库能力**（已在真机用的功能），
 * 不是杜撰，所以补齐声明而不是改调用方。
 *
 * 原则：本文件只补**类型声明**，不改任何运行时行为。官方包补齐后（升级依赖并验证）
 * 可整体删除本文件。
 *
 * 覆盖：
 * - wx.getWindowInfo()            基础库 2.20.1+（窗口信息，替代 getSystemInfoSync 的窗口部分）
 * - wx.createWebAudioContext()    基础库 2.19.0+（TTS PCM 播放用）
 * - wx.request({ enableChunked }) 基础库 2.19.0+（分块传输，TTS 流式接收）
 * - RequestTask.onChunkReceived() 同上，配合 enableChunked 接收分片
 */

declare namespace WechatMiniprogram {
  /** wx.getWindowInfo() 返回值（官方命名 WindowInfo） */
  interface WindowInfo {
    /** 设备像素比 */
    pixelRatio: number;
    /** 屏幕宽度（px） */
    screenWidth: number;
    /** 屏幕高度（px） */
    screenHeight: number;
    /** 可使用窗口宽度（px） */
    windowWidth: number;
    /** 可使用窗口高度（px） */
    windowHeight: number;
    /** 状态栏高度（px） */
    statusBarHeight: number;
    /** 竖屏正方向下的安全区域 */
    safeArea?: IAnyObject;
    /** 窗口上边缘的 y 值 */
    screenTop?: number;
  }

  interface Wx {
    /**
     * 获取窗口信息（基础库 2.20.1+）
     * 与 getSystemInfoSync 的区别：只返回窗口/屏幕相关字段，不含设备与授权信息，开销更小
     */
    getWindowInfo(): WindowInfo;
    /**
     * 创建 WebAudio 上下文（基础库 2.19.0+）
     * 返回类型保持宽松：项目用到 decodeAudioData / createBufferSource 等链，
     * 官方包未声明该类型，逐方法补全收益低且易与后续版本冲突
     */
    createWebAudioContext(): IAnyObject;
  }

  // 泛型参数与官方声明必须完全一致，否则接口合并失败
  interface RequestOption<
    T extends string | IAnyObject | ArrayBuffer = string | IAnyObject | ArrayBuffer,
  > {
    /**
     * 开启分块传输（基础库 2.19.0+）
     * 开启后响应不再走 success 整包回调，改由 RequestTask.onChunkReceived 分片下发
     */
    enableChunked?: boolean;
  }

  interface RequestTask {
    /**
     * 监听分块传输的分片数据（配合 enableChunked: true 使用）
     */
    onChunkReceived(callback: (res: { data: ArrayBuffer }) => void): void;
  }
}
