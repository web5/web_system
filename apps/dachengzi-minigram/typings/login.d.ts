/** 小程序登录相关类型定义 */

interface ILoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: IUserInfo;
}

interface IMiniProgramLoginResponse extends ILoginResponse {
  isNewUser: boolean;
}

interface IUserInfo {
  id: number;
  username: string;
  email?: string;
  nickname?: string;
  avatar?: string;
  roles: string[];
}

interface IAppOption {
  globalData: {
    userInfo: IUserInfo | null;
    token: string;
    refreshToken: string;
    apiBase: string;
    /** 当前选中的 tabBar 索引（0/1/2）：自定义 tabBar 组件每页独立实例，切 tab 后新实例
     *  selected 回到 0，需跨实例共享该值以在 attached 时立即高亮（见 utils/tabbar.ts 与
     *  custom-tab-bar/index.ts）。undefined = 尚未登记（首启由 syncFromRoute 兜底）。 */
    tabIndex?: number;
  };
  /** 圆角风格：当前页面根节点应叠加的 class（各页 onShow 调用；口径 specs/radius-style-dual §4.2） */
  radiusClassOf(): string;
  /** 启动时自动登录（已有 token 则跳过；实现在 app.ts） */
  autoLogin(): Promise<void>;
  /**
   * 极简事件总线：跨页面广播（实现在 app.ts）。
   * 必须在此声明 —— App<IAppOption>({...}) 的对象字面量受 Options<IAppOption> 约束，
   * 未声明的字段会被判 TS2353「多余属性」，而不是自动挂到实例上。
   * 当前承载 `auth:expired`：request 层 401 清 token 后广播，各页收信弹登录墙。
   */
  eventBus: {
    on(event: string, handler: (payload?: unknown) => void): void;
    off(event: string, handler: (payload?: unknown) => void): void;
    emit(event: string, payload?: unknown): void;
  };
}
