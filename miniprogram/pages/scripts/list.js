// 剧本列表：搜索/分级/类型筛选 + 分页（全量468本）
const { request, toastErr } = require('../../utils/request');

Page({
  data: {
    keyword: '',
    grade: '',
    type: '',
    grades: ['', '12+', '18+'],
    types: ['', '推理', '机制', '情感', '阵营', '还原', '欢乐', '微恐', '跑团'],
    list: [], total: 0, page: 1, size: 20, loading: false, hasMore: true
  },
  onLoad() { this.load(true); },
  onSearch(e) {
    this.setData({ keyword: e.detail.value });
    clearTimeout(this._st); // 300ms防抖，避免每键一发请求
    this._st = setTimeout(() => this.load(true), 300);
  },
  onGrade(e) { this.setData({ grade: e.currentTarget.dataset.v }); this.load(true); },
  onType(e) { this.setData({ type: e.currentTarget.dataset.v }); this.load(true); },
  load(reset) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true });
    request(`/api/public/scripts?keyword=${encodeURIComponent(this.data.keyword)}&grade=${encodeURIComponent(this.data.grade)}&type=${encodeURIComponent(this.data.type)}&page=${page}&size=${this.data.size}`)
      .then(d => {
        const list = reset ? d.data.list : this.data.list.concat(d.data.list);
        this.setData({ list, total: d.data.total, page, hasMore: list.length < d.data.total });
      })
      .catch(toastErr)
      .finally(() => this.setData({ loading: false }));
  },
  onReachBottom() { if (this.data.hasMore) this.load(false); },
  goDetail(e) { wx.navigateTo({ url: '/pages/scripts/detail?id=' + e.currentTarget.dataset.id }); }
});
