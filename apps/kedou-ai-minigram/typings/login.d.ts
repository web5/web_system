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
  avatar?: string;
  roles: string[];
}

interface IAppOption {
  globalData: {
    userInfo: IUserInfo | null;
    token: string;
    refreshToken: string;
    apiBase: string;
    /** 变变：原画 base64 */
    bianbianOrigin?: string;
    /** 变变：原画描述 */
    bianbianDesc?: string;
    /** 变变：AI 生成结果 base64 */
    bianbianResult?: string;
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
    on(event: string, handler: (payload?: any) => void): void;
    off(event: string, handler: (payload?: any) => void): void;
    emit(event: string, payload?: any): void;
  };
}
