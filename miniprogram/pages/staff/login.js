// 员工/DM 登录：独立账号（编号1~30），与玩家免登录体系隔离
const { request, toastErr } = require('../../utils/request');

Page({
  data: { staff_no: '', password: '', loading: false },

  onInput(e) { this.setData({ [e.currentTarget.dataset.f]: e.detail.value }); },

  login() {
    const { staff_no, password, loading } = this.data;
    if (loading) return;
    if (!staff_no || !password) return wx.showToast({ title: '请输入编号和密码', icon: 'none' });
    this.setData({ loading: true });
    request('/api/staff/login', 'POST', { staff_no: +staff_no, password })
      .then(d => {
        wx.setStorageSync('token', d.data.token);
        wx.setStorageSync('staff', d.data);
        wx.redirectTo({ url: '/pages/staff/home' });
      })
      .catch(toastErr)
      .finally(() => this.setData({ loading: false }));
  }
});
