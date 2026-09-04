// 网络请求封装：玩家凭 X-Openid（免登录），员工凭 Bearer Token（角色隔离）
// 多租户：TENANT 为贴牌品牌码；一牌一包，发布不同品牌时改这里重新发包即可
const BASE = 'http://127.0.0.1:3000'; // 本地调试（在开发者工具勾选"不校验合法域名"）
const TENANT = 'migong';
// 云托管：开通后填写环境ID和服务名，填了 CLOUD_ENV 即走云托管，忽略 BASE
const CLOUD_ENV = 'cloud1-d2gf4md2b6774cdc0'; // 云开发环境ID
const CLOUD_SERVICE = 'maze-kill-api'; // 云托管服务名

function buildHeader() {
  return {
    'X-Openid': wx.getStorageSync('openid') || '',
    'X-Tenant': TENANT,
    'Authorization': wx.getStorageSync('token') ? 'Bearer ' + wx.getStorageSync('token') : ''
  };
}

function toQuery(data) {
  const s = Object.keys(data || {})
    .filter(k => data[k] !== undefined && data[k] !== null && data[k] !== '')
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(data[k]))
    .join('&');
  return s ? '?' + s : '';
}

function request(path, method = 'GET', data = {}) {
  // 云托管通道：免域名备案，微信内自带身份凭证
  if (CLOUD_ENV) {
    const isGet = method.toUpperCase() === 'GET';
    return wx.cloud.callContainer({
      config: { env: CLOUD_ENV },
      service: CLOUD_SERVICE,
      path: isGet ? path + toQuery(data) : path,
      method: method.toUpperCase(),
      header: buildHeader(),
      data: isGet ? undefined : data
    }).then(r => {
      if (r.statusCode >= 200 && r.statusCode < 300) return r.data;
      const msg = (r.data && r.data.msg) || '请求失败';
      throw { code: r.statusCode, msg };
    }).catch(e => {
      if (e && e.msg) throw e;
      throw { msg: '网络异常，请稍后再试' };
    });
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
      method,
      data,
      header: buildHeader(),
      success(r) {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          resolve(r.data);
        } else {
          const msg = (r.data && r.data.msg) || '请求失败';
          reject({ code: r.statusCode, msg });
        }
      },
      fail() { reject({ msg: '网络异常，请确认后端已启动' }); }
    });
  });
}

// 玩家一键登录：wx.login 换openid → 后端自动建user档案并签发JWT（缓存三件套）
// 被管理员设为DM后，token带dm_id，可进DM工作台
function ensureLogin(force) {
  const openid = wx.getStorageSync('openid');
  if (!force && openid && wx.getStorageSync('token')) {
    return Promise.resolve(wx.getStorageSync('user') || {});
  }
  return new Promise(resolve => {
    wx.login({
      success(r) {
        request('/api/public/login', 'POST', { code: r.code, openid })
          .then(d => {
            wx.setStorageSync('openid', d.data.openid);
            wx.setStorageSync('token', d.data.token);
            wx.setStorageSync('user', { ...d.data.user, openid: d.data.openid });
            wx.removeStorageSync('staff'); // 玩家登录覆盖token，清除旧员工会话防止身份串显
            resolve(wx.getStorageSync('user'));
          })
          .catch(() => resolve(null));
      },
      fail: () => resolve(null)
    });
  });
}

// 兼容旧调用：只需openid（预约/会员卡按openid关联）
function ensureOpenid() {
  return ensureLogin().then(() => wx.getStorageSync('openid') || '');
}

function toastErr(e) { wx.showToast({ title: (e && e.msg) || '操作失败', icon: 'none' }); }

module.exports = { request, ensureLogin, ensureOpenid, toastErr, BASE, TENANT, CLOUD_ENV };
