// DM列表：仅公开信息（花名/形象照/标签/简介）
const { request, toastErr } = require('../../utils/request');

// tags 兼容三种格式：数组 / JSON字符串 / 逗号字符串
function parseTags(t) {
  if (Array.isArray(t)) return t;
  if (typeof t !== 'string' || !t) return [];
  if (t[0] === '[') { try { return JSON.parse(t); } catch (e) { return []; } }
  return t.split(',').filter(Boolean);
}

Page({
  data: { list: [] },
  onLoad() {
    request('/api/public/dms').then(d => {
      const list = (d.data || []).map(x => ({ ...x, tagsArr: parseTags(x.tags) }));
      this.setData({ list });
    }).catch(toastErr);
  }
});
