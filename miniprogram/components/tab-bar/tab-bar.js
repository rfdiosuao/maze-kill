// 底部导航：首页 / 剧本 / 帖子 / 我的
// 用法：页面 wxml 放 <tab-bar active="index"/> ；页面切换用 reLaunch 清栈，避免 tab 页无限叠加
Component({
  properties: {
    active: {
      type: String,
      value: 'index'
    }
  },

  data: {
    tabs: [
      { key: 'index',  icon: '/assets/icons/tab-home.png',   text: '首页', url: '/pages/index/index' },
      { key: 'scripts',icon: '/assets/icons/tab-script.png', text: '剧本', url: '/pages/scripts/list' },
      { key: 'posts',  icon: '/assets/icons/tab-post.png',   text: '帖子', url: '/pages/posts/index' },
      { key: 'user',   icon: '/assets/icons/tab-me.png',     text: '我的', url: '/pages/user/index' }
    ]
  },
  methods: {
    onTap(e) {
      const { key, url } = e.currentTarget.dataset;
      if (key === this.data.active) return;      // 已是当前 tab，不动作
      // reLaunch：清空页面栈直达目标 tab，避免 tab 间反复 push 造成栈溢出
      wx.reLaunch({ url });
    }
  }
});
