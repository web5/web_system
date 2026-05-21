// app.ts
App({
  onLaunch() {
    console.log('Mini app launched');
  },
  globalData: {
    userInfo: null as any,
    apiBase: 'https://api.kedouai.com',
  },
});
