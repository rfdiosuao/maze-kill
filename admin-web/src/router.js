import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/login', component: () => import('./views/Login.vue') },
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', component: () => import('./views/Dashboard.vue'), meta: { title: '总览', menu: true } },
  { path: '/sessions', component: () => import('./views/Sessions.vue'), meta: { title: '场次排班', menu: true } },
  { path: '/staff', component: () => import('./views/Staff.vue'), meta: { title: '员工账号', menu: true } },
  { path: '/users', component: () => import('./views/Users.vue'), meta: { title: '小程序用户', menu: true } },
  { path: '/scripts', component: () => import('./views/Scripts.vue'), meta: { title: '剧本管理', menu: true } },
  { path: '/salary', component: () => import('./views/Salary.vue'), meta: { title: '薪资管理', menu: true } },
  { path: '/cards', component: () => import('./views/Cards.vue'), meta: { title: '会员卡', menu: true } },
  { path: '/settings', component: () => import('./views/Settings.vue'), meta: { title: '系统设置', menu: true } }
];

const router = createRouter({ history: createWebHashHistory(), routes });

// 仅超管可进后台（JWT校验在服务端，这里做前端拦截体验）
router.beforeEach(to => {
  if (to.path !== '/login' && !localStorage.getItem('token')) return '/login';
  document.title = (to.meta.title ? to.meta.title + ' · ' : '') + '迷宫全息剧本杀管理后台';
});

export default router;
