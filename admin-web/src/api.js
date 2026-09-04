// axios封装：自动带JWT；401跳登录；403提示越权
import axios from 'axios';
import { ElMessage } from 'element-plus';
import router from './router';

const api = axios.create({ baseURL: '/api', timeout: 15000 });

api.interceptors.request.use(cfg => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = 'Bearer ' + t;
  // 多租户：当前选中品牌（顶栏切换器写入；默认 migong）
  cfg.headers['X-Tenant'] = localStorage.getItem('tenant') || 'migong';
  return cfg;
});

api.interceptors.response.use(
  res => res.data,
  err => {
    const s = err.response && err.response.status;
    const msg = (err.response && err.response.data && err.response.data.msg) || '请求失败';
    if (s === 401) {
      localStorage.removeItem('token');
      router.push('/login');
      ElMessage.error('登录已过期，请重新登录');
    } else if (s === 403) {
      ElMessage.error('越权访问已拒绝：' + msg);
    } else {
      ElMessage.error(msg);
    }
    return Promise.reject(err);
  }
);

export default api;
