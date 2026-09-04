// 谜宫全息剧本杀 小程序入口
App({
  globalData: {
    // 玩家一键登录（openid+user档案+JWT）；员工独立登录后存token；DM玩家token带dm_id
    openid: '',
    token: '',
    user: null,
    staff: null
  },
  onLaunch() {
    // 云托管：request.js 中填了 CLOUD_ENV 后初始化云环境
    const { CLOUD_ENV } = require('./utils/request');
    if (CLOUD_ENV && wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
    }
    this.globalData.openid = wx.getStorageSync('openid') || '';
    this.globalData.token = wx.getStorageSync('token') || '';
    this.globalData.user = wx.getStorageSync('user') || null;
    this.globalData.staff = wx.getStorageSync('staff') || null;
  }
});
