// 我的·账户：微信一键登录（自动建档）；被管理员设为DM后出现工作台入口
const { request, ensureLogin, toastErr, BASE } = require('../../utils/request');

// 补充展示字段：头像完整URL（相对路径拼BASE）+ 昵称首字（WXML不支持方法调用，须预计算）
function withView(p) {
  const avatarFull = p.avatar ? (p.avatar.indexOf('http') === 0 ? p.avatar : BASE + p.avatar) : '';
  return { ...p, avatarFull, initial: (p.nickname || '谜')[0] };
}

Page({
  data: { saving: false, user: null },

  onShow() { this.refresh(); },

  // 拉最新资料：管理员设/撤DM后实时生效；角色变化时静默重签token
  refresh() {
    if (!wx.getStorageSync('openid')) { this.setData({ user: null }); return; }
    // token缺失（如退出过工作台/过期）：静默重签，保证玩家JWT可用
    const pre = !wx.getStorageSync('token')
      ? ensureLogin(true)
      : Promise.resolve();
    pre.catch(() => {}).then(() => this.loadProfile());
  },

  loadProfile() {
    request('/api/public/profile').then(d => {
      const p = d.data;
      const old = wx.getStorageSync('user') || {};
      const roleChanged = (old.role || '') !== p.role || (!!old.dm_id) !== (!!p.dm_id);
      this.setData({ user: withView(p) });
      wx.setStorageSync('user', { ...p });
      if (roleChanged) ensureLogin(true);
    }).catch(e => {
      if (e.code === 401 || e.code === 404) {
        // 登录态失效：清缓存回到未登录
        ['openid', 'token', 'user'].forEach(k => wx.removeStorageSync(k));
        this.setData({ user: null });
      } else { toastErr(e); }
    });
  },

  // 一键登录（wx.login静默 + 后端自动注册）
  login() {
    ensureLogin(true).then(u => {
      if (u) { this.refresh(); }
      else toastErr({ msg: '登录失败，请稍后再试' });
    });
  },

  // 换头像：chooseAvatar临时文件 → 压缩 → base64上传持久化
  onChooseAvatar(e) {
    const temp = e.detail.avatarUrl;
    if (!temp) return;
    const upload = filePath => {
      // 按后缀识别真实格式（compressImage可能保留png/webp）
      const ext = (/\.(\w+)(\?|$)/.exec(filePath) || [])[1] || 'jpg';
      const mime = ext === 'png' ? 'png' : (ext === 'webp' ? 'webp' : 'jpeg');
      wx.getFileSystemManager().readFile({
        filePath, encoding: 'base64',
        success: rr => {
          this.setData({ saving: true });
          request('/api/public/avatar', 'POST', { base64: `data:image/${mime};base64,` + rr.data })
            .then(d => {
              const user = { ...this.data.user, avatar: d.data.url };
              this.setData({ user: withView(user), saving: false });
              wx.showToast({ title: '头像已更新', icon: 'success' });
            })
            .catch(err => { this.setData({ saving: false }); toastErr(err); });
        },
        fail: () => toastErr({ msg: '读取图片失败' })
      });
    };
    wx.compressImage({
      src: temp, quality: 60,
      success: r => upload(r.tempFilePath),
      fail: () => upload(temp) // 低版本基础库降级用原图
    });
  },

  // 昵称（type=nickname，微信键盘授权）失焦保存
  onNickname(e) {
    const nickname = (e.detail.value || '').trim();
    if (!this.data.user || nickname === this.data.user.nickname) return;
    request('/api/public/profile', 'PUT', { nickname }).then(() => {
      const user = { ...this.data.user, nickname };
      this.setData({ user: withView(user) });
      wx.setStorageSync('user', user);
      wx.showToast({ title: '昵称已保存', icon: 'none' });
    }).catch(toastErr);
  },

  // 手机号
  onPhone(e) { this.setData({ 'user.phone': e.detail.value }); },
  savePhone() {
    request('/api/public/profile', 'PUT', { phone: this.data.user.phone || '' })
      .then(d => wx.showToast({ title: d.msg, icon: 'none' }))
      .catch(toastErr);
  },

  // 菜单
  goBookings() { wx.navigateTo({ url: '/pages/member/card?tab=booking' }); },
  goMember() { wx.navigateTo({ url: '/pages/member/card' }); },
  goStaffHome() { wx.navigateTo({ url: '/pages/staff/home' }); },
  goStaffLogin() { wx.navigateTo({ url: '/pages/staff/login' }); },

  logout() {
    wx.showModal({
      title: '退出登录', content: '退出后需重新登录，预约与会员卡数据不会丢失。',
      success: r => {
        if (!r.confirm) return;
        ['openid', 'token', 'user', 'staff'].forEach(k => wx.removeStorageSync(k));
        this.setData({ user: null });
      }
    });
  }
});
