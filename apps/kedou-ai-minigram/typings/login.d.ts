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
}
