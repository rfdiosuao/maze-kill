// 首页：顶部栏 + 主Banner + 四宫格 + 热门剧本/DM横滑 + 会员卡 + 到店信息
const { request, ensureOpenid, toastErr } = require('../../utils/request');

const BADGE = { '城限': 'city', '独家': 'exclusive', '实景': 'live', '盒装': 'box' };

Page({
  data: {
    statusBar: 20,
    capsuleW: 95,
    setting: {},
    member: {},
    memberText: '开通即享优惠 · 余额与卡券',
    hotScripts: [],
    dms: [],
    entries: [
      { key: 'scripts', icon: '/assets/icons/book.png', title: '剧本' },
      { key: 'dms', icon: '/assets/icons/mask.png', title: 'DM' },
      { key: 'booking', icon: '/assets/icons/calendar.png', title: '立即预约' },
      { key: 'member', icon: '/assets/icons/card.png', title: '会员卡' }
    ]
  },

  onLoad() {
    // 自定义导航：状态栏高度 + 右侧微信胶囊避让
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    this.setData({
      statusBar: win.statusBarHeight || 20,
      capsuleW: menu ? Math.ceil(win.windowWidth - menu.left) + 8 : 95
    });

    request('/api/public/home').then(d => this.setData({ setting: d.data })).catch(() => {});

    // 热门剧本（取前 8 本）
    request('/api/public/scripts', 'GET', { size: 8 }).then(d => {
      const hotScripts = (d.data.list || []).map(s => ({ ...s, badgeClass: BADGE[s.grade] || 'box' }));
      this.setData({ hotScripts });
    }).catch(() => {});

    // DM 天团
    request('/api/public/dms').then(d => {
      const dms = (d.data || []).map(m => {
        let tags = m.tags;
        if (typeof tags === 'string') { try { tags = JSON.parse(tags); } catch (e) { tags = [tags]; } }
        return { ...m, style: (tags && tags[0]) || '金牌主持', initial: (m.stage_name || '谜')[0] };
      });
      this.setData({ dms });
    }).catch(() => {});

    // 会员卡（需 openid）
    ensureOpenid().then(() => request('/api/public/member')).then(d => {
      const { card, coupons = [] } = d.data || {};
      const valid = coupons.filter(c => c.status === 'valid').length;
      this.setData({
        member: { card },
        memberText: card ? `余额 ¥${card.balance} · ${valid} 张优惠券待使用` : '开通即享优惠 · 余额与卡券'
      });
    }).catch(() => {});
  },

  onEntry(e) {
    const url = {
      scripts: '/pages/scripts/list', dms: '/pages/dms/list',
      booking: '/pages/booking/index', member: '/pages/member/card'
    }[e.currentTarget.dataset.key];
    wx.navigateTo({ url });
  },
  goScripts() { wx.navigateTo({ url: '/pages/scripts/list' }); },
  goDms() { wx.navigateTo({ url: '/pages/dms/list' }); },
  goMember() { wx.navigateTo({ url: '/pages/member/card' }); },
  goScriptDetail(e) { wx.navigateTo({ url: `/pages/scripts/detail?id=${e.currentTarget.dataset.id}` }); },

  // 到店导航 / 电话 / 客服微信
  onNav() {
    const s = this.data.setting;
    wx.openLocation({ latitude: +s.lat || 31.23, longitude: +s.lng || 121.47, name: '谜宫全息剧本演绎', address: s.address || '' });
  },
  onCall() { wx.makePhoneCall({ phoneNumber: this.data.setting.phone || '' }); },
  onWechat() {
    if (!this.data.setting.wechat) return toastErr({ msg: '暂未配置' });
    wx.setClipboardData({ data: this.data.setting.wechat });
  }
});
