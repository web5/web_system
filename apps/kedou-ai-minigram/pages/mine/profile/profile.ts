// 个人信息
Page({
  data: {
    nickname: '橙子哥哥',
    uid: '100238',
    joinedAt: '2026-03',
    phone: '138****6688',
    email: '未绑定',
    realName: '已认证',
  },

  editNickname() { wx.showToast({ title: '修改昵称开发中', icon: 'none' }); },
  editPhone() { wx.showToast({ title: '更换手机号开发中', icon: 'none' }); },
  bindEmail() { wx.showToast({ title: '绑定邮箱开发中', icon: 'none' }); },
  goVerify() { wx.showToast({ title: '已实名认证', icon: 'none' }); },
  bindWechat() { wx.showToast({ title: '已绑定微信', icon: 'none' }); },
});
