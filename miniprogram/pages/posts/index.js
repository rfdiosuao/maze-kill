// 发现 · 帖子（社区流）
// 说明：当前为前端演示数据；后端若新增 posts 接口，把 load() 换成 request 拉取即可
Page({
  data: {
    tabs: ['推荐', '车队', '测评', '组局'],
    tab: '推荐',
    posts: []
  },

  onLoad() { this.load(); },

  load() {
    // TODO: 接入后端 /api/public/posts 后替换为真实数据
    this.setData({ posts: DEMO });
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.v;
    this.setData({ tab });
    if (tab === '推荐') this.setData({ posts: DEMO });
    else this.setData({ posts: DEMO.filter(p => p.tag === tab) });
  },

  onPost() {
    wx.showToast({ title: '帖子详情（示例）', icon: 'none' });
  },

  onLike(e) {
    const id = e.currentTarget.dataset.id;
    const posts = this.data.posts.map(p => p.id === id ? { ...p, liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) } : p);
    this.setData({ posts });
  },

  onPublish() {
    wx.showToast({ title: '发帖功能开发中', icon: 'none' });
  }
});

// —— 演示数据 ——
const DEMO = [
  { id: 1, tag: '测评', cover: '', title: '《千佛梦》城限测评：丝滑恐怖本天花板', author: '阿荧', role: 'DM', likes: 128, comments: 36, book: '千佛梦' },
  { id: 2, tag: '组局', cover: '', title: '周六晚 19:00 缺1名高配，机制阵营本求老司机', author: '雾川', role: '玩家', likes: 32, comments: 12, book: '孤城' },
  { id: 3, tag: '车队', cover: '', title: '密室逃脱团建车队 · 长线锁本可带新', author: '烛岚', role: 'DM', likes: 89, comments: 21, book: '' },
  { id: 4, tag: '测评', cover: '', title: '《千佛梦》开荒repo，反转哭到妆花', author: '影月', role: 'DM', likes: 210, comments: 58, book: '千佛梦' },
  { id: 5, tag: '组局', cover: '', title: '工作日午场拼车，硬核推理速推队', author: '白露', role: '玩家', likes: 45, comments: 9, book: '' },
  { id: 6, tag: '车队', cover: '', title: '约《第七个客人》整季，可拆本', author: '青岚', role: '玩家', likes: 67, comments: 14, book: '第七个客人' }
];
