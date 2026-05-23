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
  };
}
