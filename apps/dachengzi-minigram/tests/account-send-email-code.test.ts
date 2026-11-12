/**
 * sendEmailCode 的行为单测
 *
 * 钉住「发送邮箱验证码成功提示固定文案」决策后的服务层口径：
 *   ① 请求路径与载荷：POST /api/users/email/code，body 为 { email }；
 *   ② 无论后端返回何种成功形态（信封 data.message / data:null / 裸 {message}），
 *      一律 resolve 为 undefined —— 服务层不再解包任何文案，
 *      toast 固定文案在页面层，后端信封 message:'success' 永不可能透出；
 *   ③ 错误路径不被吞：post reject 时 sendEmailCode 同样 reject（页面 catch 依赖）。
 */
import { sendEmailCode } from '../services/account';

jest.mock('../utils/request', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  setToken: jest.fn(),
  getToken: jest.fn(),
}));

import { post } from '../utils/request';

const postMock = post as jest.Mock;

// 兜底 wx（本套用例不触发，仅为 account.ts 模块加载安全）
(globalThis as { wx?: unknown }).wx = { getStorageSync: jest.fn(() => '') };

describe('sendEmailCode', () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it('以 /api/users/email/code 与 { email } 调用 post', async () => {
    postMock.mockResolvedValueOnce({ code: 0, data: null, message: 'success' });

    await sendEmailCode('a@x.com');
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('/api/users/email/code', { email: 'a@x.com' });
  });

  it('信封 {code:0, data:{message:业务文案}, message:"success"} → resolve undefined，不解包文案', async () => {
    postMock.mockResolvedValueOnce({
      code: 0,
      data: { message: '验证码已发送至 a@x.com，请查收' },
      message: 'success',
    });

    const res = await sendEmailCode('a@x.com');
    expect(res).toBeUndefined();
  });

  it('信封 {code:0, data:null, message:"success"} → resolve undefined，不抛错（信封透出 success 回归哨兵）', async () => {
    postMock.mockResolvedValueOnce({ code: 0, data: null, message: 'success' });

    const res = await sendEmailCode('a@x.com');
    expect(res).toBeUndefined();
  });

  it('裸返回 { message: "x" }（无信封）→ resolve undefined', async () => {
    postMock.mockResolvedValueOnce({ message: 'x' });

    const res = await sendEmailCode('a@x.com');
    expect(res).toBeUndefined();
  });

  it('post reject → sendEmailCode 同样 reject（错误路径不被吞）', async () => {
    const err = { data: { message: '发送太频繁，请稍后再试' } };
    postMock.mockRejectedValueOnce(err);

    await expect(sendEmailCode('a@x.com')).rejects.toBe(err);
  });
});
