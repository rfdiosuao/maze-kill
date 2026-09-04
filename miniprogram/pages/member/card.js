// 会员卡：余额/券/流水 + 我的预约（可取消释放）
const { request, ensureOpenid, toastErr } = require('../../utils/request');

Page({
  data: { tab: 'card', card: null, coupons: [], flows: [], bookings: [] },

  onLoad(q) {
    if (q.tab) this.setData({ tab: q.tab });
    this._ready = false;
    ensureOpenid().then(() => { this._ready = true; this.load(); });
  },
  // 首次进入由 onLoad 的登录回调触发，onShow 跳过避免重复并发请求
  onShow() { if (this._ready) this.load(); },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.k }); },

  load() {
    request('/api/public/member').then(d => {
      this.setData({ card: d.data.card, coupons: d.data.coupons, flows: d.data.flows });
    }).catch(toastErr);
    request('/api/public/my/bookings').then(d => this.setData({ bookings: d.data })).catch(toastErr);
  },

  // 取消预约 → 释放DM占用
  onCancel(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '取消预约', content: '确定取消该预约吗？DM时段将被释放，卡内支付将原路退回。',
      success: r => {
        if (!r.confirm) return;
        request(`/api/public/bookings/${id}/cancel`, 'POST')
          .then(d => { wx.showToast({ title: d.msg, icon: 'none' }); this.load(); })
          .catch(toastErr);
      }
    });
  }
});
