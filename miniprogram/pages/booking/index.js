// 预约（核心）：未来30天日历 → 午/晚场 → 场次(剧本) → 锁1名空闲DM → 提交
// 空闲DM可锁（红色高亮），已被占用/请假置灰；同时段冲突由后端强校验兜底
const { request, ensureOpenid, toastErr } = require('../../utils/request');

const WD = ['日', '一', '二', '三', '四', '五', '六'];
const pad = n => String(n).padStart(2, '0');

Page({
  data: {
    dates: [], selDate: '', slots: [{ key: 'noon', name: '午场' }, { key: 'night', name: '晚场' }],
    selSlot: '', sessions: [], selSession: null, detail: null,
    selDm: null, prefScript: 0, onlyPref: false,
    form: { name: '', phone: '', people: 4, payType: 'store', useCoupon: false },
    hasCard: false, hasCoupon: false, submitting: false
  },

  onLoad(q) {
    // 生成未来30天日历
    const dates = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      dates.push({
        key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        label: i === 0 ? '今天' : i === 1 ? '明天' : `${d.getMonth() + 1}月${d.getDate()}日`,
        week: '周' + WD[d.getDay()]
      });
    }
    this.setData({ dates, selDate: dates[0].key, prefScript: +q.script_id || 0 });
    ensureOpenid().then(() => {
      this.loadMember();
      this.pickSlot('noon');
    });
  },

  loadMember() {
    request('/api/public/member').then(d => {
      const coupons = (d.data.coupons || []).filter(c => c.status === 'valid');
      this.setData({ hasCard: !!(d.data.card && d.data.card.status === 'active'), hasCoupon: coupons.length > 0 });
    }).catch(() => {});
  },

  pickDate(e) { this.setData({ selDate: e.currentTarget.dataset.k, selSession: null, detail: null }); this.loadSessions(); },
  pickSlot(e) { this.setData({ selSlot: e.currentTarget ? e.currentTarget.dataset.k : e, selSession: null, detail: null }); this.loadSessions(); },

  loadSessions() {
    request(`/api/public/sessions?date=${this.data.selDate}&slot=${this.data.selSlot}`)
      .then(d => {
        let list = d.data || [];
        // 从剧本详情进入时，默认只看该本的场次（可切换）
        if (this.data.prefScript && this.data.onlyPref) {
          list = list.filter(s => s.script_id === this.data.prefScript);
        }
        this.setData({ sessions: list });
      })
      .catch(toastErr);
  },
  toggleOnly() { this.setData({ onlyPref: !this.data.onlyPref }); this.loadSessions(); },

  // 选场次 → 拉取已排DM与可锁DM池
  pickSession(e) {
    const s = this.data.sessions.find(x => x.id === +e.currentTarget.dataset.id);
    if (!s || s.assigned >= s.required_dm) {
      return wx.showToast({ title: s ? '该场DM已满' : '场次不存在', icon: 'none' });
    }
    this.setData({ selSession: s, selDm: null });
    request(`/api/public/sessions/${s.id}/dms`).then(d => this.setData({ detail: d.data })).catch(toastErr);
  },

  // 锁卡选DM：仅空闲可点，占用置灰
  pickDm(e) {
    const dm = this.data.detail.pool.find(x => x.id === +e.currentTarget.dataset.id);
    if (!dm) return;
    if (!dm.can_lock) return wx.showToast({ title: dm.reason || '该DM不可选', icon: 'none' });
    this.setData({ selDm: dm });
  },

  onInput(e) { const f = { ...this.data.form }; f[e.currentTarget.dataset.f] = e.detail.value; this.setData({ form: f }); },
  onPeople(e) { this.setData({ 'form.people': +e.detail.value }); },
  onPay(e) { this.setData({ 'form.payType': e.currentTarget.dataset.v }); },
  onCoupon() { this.setData({ 'form.useCoupon': !this.data.form.useCoupon }); },

  // 提交锁卡预约
  submit() {
    const { selSession, selDm, form, submitting } = this.data;
    if (submitting) return;
    if (!selSession || !selDm) return wx.showToast({ title: '请先选场次和DM', icon: 'none' });
    if (!form.name || !form.phone) return wx.showToast({ title: '请填写联系人和电话', icon: 'none' });
    if (form.payType === 'card' && !this.data.hasCard) {
      return wx.showToast({ title: '暂无有效会员卡，将转为到店支付', icon: 'none' });
    }
    this.setData({ submitting: true });
    request('/api/public/bookings', 'POST', {
      session_id: selSession.id, dm_id: selDm.id,
      name: form.name, phone: form.phone, people: form.people,
      pay_type: form.payType, use_coupon: form.useCoupon
    }).then(d => {
      const pay = d.data.cardPay ? `会员卡已扣 ¥${d.data.amount}` : '请到店支付';
      wx.showModal({
        title: '锁卡成功', content: `已锁定DM「${selDm.stage_name}」，${pay}`,
        showCancel: false, success: () => wx.navigateTo({ url: '/pages/member/card?tab=booking' })
      });
      this.setData({ selDm: null });
      this.loadSessions(); // 场次assigned已变，列表与DM池都刷新，避免本地旧数据误报"已满"
      this.refreshDmPool(selSession.id);
    }).catch(e => {
      toastErr(e); // 冲突会在此提示（如"该DM已被占用"）
      this.loadSessions();
      this.refreshDmPool(selSession.id);
    }).finally(() => this.setData({ submitting: false }));
  },

  // 静默刷新DM池（不触发"该场已满"提示，避免与冲突toast重复）
  refreshDmPool(id) {
    request(`/api/public/sessions/${id}/dms`).then(d => this.setData({ detail: d.data })).catch(() => {});
  }
});
