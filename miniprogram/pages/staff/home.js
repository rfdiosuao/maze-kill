// 员工工作台：我的排班 / 我的薪资(仅本人) / 公开提成表 / 资料编辑
const { request, toastErr } = require('../../utils/request');

Page({
  data: {
    tab: 'schedule',
    staff: {}, me: {},
    schedule: [],
    months: [], month: '', salary: null,
    comm: { list: [], keyword: '', page: 1, total: 0, hasMore: true, expanded: {} },
    loading: false
  },

  onLoad() {
    if (!wx.getStorageSync('token')) { wx.redirectTo({ url: '/pages/staff/login' }); return; }
    let staff = wx.getStorageSync('staff');
    // 被设为DM的小程序玩家：无员工编号，资料取自登录账户
    if (!staff) {
      const u = wx.getStorageSync('user') || {};
      staff = { name: u.nickname || u.stage_name || 'DM', stage_name: u.stage_name || u.nickname || 'DM', staff_no: '小程序用户', isPlayer: true };
    }
    // 近6个自然月（按月初构造，避免31号setMonth溢出导致重复/跳月）
    const months = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    this.setData({ staff, months, month: months[0] });
    this.loadMe();
    this.loadSchedule();
    this.loadSalary();
  },

  switchTab(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ tab: k });
    // 首次切到提成表时才加载，否则该tab永远空白
    if (k === 'commission' && !this.data.comm.list.length) this.loadComm(true);
  },
  onShow() { if (this.data.month) this.loadSalary(); },

  loadMe() { request('/api/staff/me').then(d => this.setData({ me: d.data || {} })).catch(toastErr); },

  // 我的排班
  loadSchedule() {
    request('/api/staff/my/schedule').then(d => this.setData({ schedule: d.data })).catch(toastErr);
  },

  // 我的薪资（强制按登录账号过滤，只看自己）
  onMonth(e) { this.setData({ month: e.currentTarget.dataset.m }); this.loadSalary(); },
  loadSalary() {
    request(`/api/staff/my/salary?month=${this.data.month}`).then(d => {
      const s = d.data || {};
      s.detail = (s.detail || []).map((x, i) => ({ ...x, idx: i }));
      this.setData({ salary: s });
    }).catch(toastErr);
  },

  // 公开提成表
  onCommSearch(e) { this.setData({ 'comm.keyword': e.detail.value }); this.loadComm(true); },
  loadComm(reset) {
    const c = this.data.comm;
    if (this.data.loading) return;
    const page = reset ? 1 : c.page + 1;
    this.setData({ loading: true });
    request(`/api/staff/commission?keyword=${encodeURIComponent(c.keyword)}&page=${page}&size=20`)
      .then(d => {
        const list = reset ? d.data.list : c.list.concat(d.data.list);
        this.setData({ comm: { ...c, list, page, total: d.data.total, hasMore: list.length < d.data.total } });
      })
      .catch(toastErr)
      .finally(() => this.setData({ loading: false }));
  },
  onReachBottom() { if (this.data.tab === 'commission' && this.data.comm.hasMore) this.loadComm(false); },
  expand(e) {
    const id = e.currentTarget.dataset.id;
    const ex = { ...this.data.comm.expanded }; ex[id] = !ex[id];
    this.setData({ 'comm.expanded': ex });
  },

  // 资料编辑
  onMeInput(e) { this.setData({ [`me.${e.currentTarget.dataset.f}`]: e.detail.value }); },
  saveMe() {
    const { phone, intro, old_password, new_password } = this.data.me;
    request('/api/staff/me', 'PUT', { phone, intro, old_password, new_password })
      .then(d => { wx.showToast({ title: d.msg, icon: 'none' }); this.setData({ 'me.new_password': '', 'me.old_password': '' }); })
      .catch(toastErr);
  },
  logout() {
    // 玩家DM：仅退出工作台（保留登录态，“我的”页可随时再进）；员工：回到员工登录页
    if (this.data.staff && this.data.staff.isPlayer) {
      wx.redirectTo({ url: '/pages/user/index' });
      return;
    }
    wx.removeStorageSync('token'); wx.removeStorageSync('staff');
    wx.redirectTo({ url: '/pages/staff/login' });
  }
});
