// 剧本详情：名称/封面/类型/人数/开场时长/价格/分级/简介/角色清单
const { request, toastErr } = require('../../utils/request');

Page({
  data: { s: null },
  onLoad(q) {
    request('/api/public/scripts/' + q.id)
      .then(d => this.setData({ s: d.data }))
      .catch(toastErr);
  },
  goBooking() { wx.navigateTo({ url: '/pages/booking/index?script_id=' + this.data.s.id }); }
});
