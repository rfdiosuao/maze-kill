// JWT 鉴权与角色隔离：玩家免登录走 /api/public；员工 role=staff；超管 role=admin
// 小程序玩家 role=player；被管理员"设为DM"的玩家 token 带 dm_id，可进员工工作台（仍只能看本人数据）
// 越权访问他人薪资或后台一律拒绝（staff 访问 admin 接口直接 403）
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'maze_kill_secret_2026';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: '7d' });
}

function auth(required) { // required: 'staff' | 'admin'
  return (req, res, next) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ code: 401, msg: '未登录' });
    let user;
    try {
      user = jwt.verify(token, SECRET);
    } catch (e) {
      return res.status(401).json({ code: 401, msg: '登录已过期，请重新登录' });
    }
    if (required === 'admin' && user.role !== 'admin') {
      return res.status(403).json({ code: 403, msg: '越权访问已拒绝' });
    }
    // 员工工作台：staff/admin，以及被设为DM的玩家（token含dm_id）
    if (required === 'staff' &&
      !(['staff', 'admin'].includes(user.role) || (user.role === 'player' && user.dm_id))) {
      return res.status(403).json({ code: 403, msg: '越权访问已拒绝' });
    }
    // 租户隔离：token 里的租户必须与请求头 X-Tenant 一致（超管admin可跨品牌切换）
    if (req.tenantId && user.role !== 'admin' && user.tenant_id && +user.tenant_id !== +req.tenantId) {
      return res.status(403).json({ code: 403, msg: '账号与当前品牌不匹配' });
    }
    req.user = user;
    next();
  };
}

module.exports = { sign, auth };
