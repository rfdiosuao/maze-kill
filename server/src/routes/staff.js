// ============================================================
// 员工/DM端接口（独立账号，编号1~30登录）
// 薪资严格按账号过滤：只看本人；底薪等保密字段永不返回
// ============================================================
const router = require('express').Router();
const pool = require('../config/db');
const { sign, auth } = require('../middleware/auth');
const { verify } = require('../utils/hash');
const { hash } = require('../utils/hash');
const salaryService = require('../services/salaryService');

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e.code === 'CONFLICT') return res.status(400).json({ code: 400, msg: e.message });
  console.error(e);
  res.status(500).json({ code: 500, msg: '服务异常，请稍后再试' });
});

// 员工登录（按当前品牌 X-Tenant 匹配账号）
router.post('/login', wrap(async (req, res) => {
  const { staff_no, password } = req.body || {};
  if (!staff_no || !password) return res.status(400).json({ code: 400, msg: '请输入编号和密码' });
  const [rows] = await pool.query(
    `SELECT a.*, d.id dm_id, d.stage_name FROM account a
      LEFT JOIN dm d ON d.account_id=a.id
      WHERE a.staff_no=? AND a.role='staff' AND a.tenant_id=?`, [staff_no, req.tenantId]);
  if (!rows.length || !verify(password, rows[0].password_hash)) {
    return res.status(400).json({ code: 400, msg: '编号或密码错误' });
  }
  const a = rows[0];
  if (a.status !== 'active') return res.status(403).json({ code: 403, msg: '账号已停用，请联系管理员' });
  const token = sign({ id: a.id, role: 'staff', staff_no: a.staff_no, dm_id: a.dm_id || null, name: a.name, tenant_id: req.tenantId });
  res.json({ code: 0, data: { token, name: a.name, staff_no: a.staff_no, dm_id: a.dm_id || null, stage_name: a.stage_name } });
}));

router.use(auth('staff')); // 以下接口需登录

// 本人资料（不含底薪）：员工查account；被设为DM的小程序玩家查user
router.get('/me', wrap(async (req, res) => {
  if (req.user.role === 'player') {
    const [rows] = await pool.query(
      `SELECT u.nickname AS name, u.avatar AS photo, u.phone, d.stage_name, d.tags, d.intro
         FROM user u LEFT JOIN dm d ON d.user_id=u.id WHERE u.id=?`, [req.user.id]);
    return res.json({ code: 0, data: rows[0] || null });
  }
  const [rows] = await pool.query(
    `SELECT a.staff_no, a.name, a.phone, d.stage_name, d.photo, d.tags, d.intro
       FROM account a LEFT JOIN dm d ON d.account_id=a.id WHERE a.id=?`, [req.user.id]);
  res.json({ code: 0, data: rows[0] || null });
}));

// 改本人资料（电话/简介/密码；玩家无密码，微信登录免密）
router.put('/me', wrap(async (req, res) => {
  const { phone, intro, old_password, new_password } = req.body || {};
  if (req.user.role === 'player') {
    if (phone != null) await pool.query(`UPDATE user SET phone=? WHERE id=?`, [phone, req.user.id]);
    if (intro != null && req.user.dm_id) {
      await pool.query(`UPDATE dm SET intro=? WHERE id=?`, [intro, req.user.dm_id]);
    }
    return res.json({ code: 0, msg: '已保存' });
  }
  if (new_password) {
    const [rows] = await pool.query(`SELECT password_hash FROM account WHERE id=?`, [req.user.id]);
    if (!verify(old_password || '', rows[0].password_hash)) {
      return res.status(400).json({ code: 400, msg: '原密码错误' });
    }
    await pool.query(`UPDATE account SET password_hash=? WHERE id=?`, [hash(new_password), req.user.id]);
  }
  if (phone != null) await pool.query(`UPDATE account SET phone=? WHERE id=?`, [phone, req.user.id]);
  if (intro != null && req.user.dm_id) {
    await pool.query(`UPDATE dm SET intro=? WHERE id=?`, [intro, req.user.dm_id]);
  }
  res.json({ code: 0, msg: '已保存' });
}));

// 我的排班：本人出场记录（时间倒序）
router.get('/my/schedule', wrap(async (req, res) => {
  if (!req.user.dm_id) return res.json({ code: 0, data: [] });
  const [rows] = await pool.query(
    `SELECT sd.id, sd.source, sd.role_name, s.work_date, s.slot, s.start_time,
            sc.name AS script_name, s.status AS session_status
       FROM session_dm sd
       JOIN session s ON s.id=sd.session_id
       JOIN script sc ON sc.id=s.script_id
      WHERE sd.dm_id=? AND s.status<>'cancelled'
      ORDER BY s.work_date DESC, s.slot`, [req.user.dm_id]);
  res.json({ code: 0, data: rows });
}));

// 我的薪资（按自然月，强制只查本人；仅管理员可指定dm_id代查）
router.get('/my/salary', wrap(async (req, res) => {
  const dmId = req.user.role === 'admin' ? (+req.query.dm_id || req.user.dm_id) : req.user.dm_id;
  // 本地时区月份（toISOString是UTC，每月1号早8点前会错取上月）
  const _n = new Date();
  const month = req.query.month || `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}`;
  if (!dmId) return res.status(400).json({ code: 400, msg: '当前账号未绑定DM档案' });
  await salaryService.recalcMonth(pool, dmId, month, req.tenantId); // 实时重算保证准确
  const [rows] = await pool.query(
    `SELECT * FROM salary_record WHERE dm_id=? AND month=? AND tenant_id=?`, [dmId, month, req.tenantId]);
  const r = rows[0] || { base_salary: 0, commission: 0, bonus: 0, deduction: 0, payable: 0, detail: [] };
  r.detail = typeof r.detail === 'string' ? JSON.parse(r.detail || '[]') : (r.detail || []);
  res.json({ code: 0, data: { month, ...r } });
}));

// 公开提成表：上架剧本的角色单场提成（全员可见，按租户）
router.get('/commission', wrap(async (req, res) => {
  const { keyword = '' } = req.query;
  const page = Math.max(1, +req.query.page || 1), size = Math.min(50, +req.query.size || 20);
  const where = [`status='on'`, `tenant_id=?`], params = [req.tenantId];
  if (keyword) { where.push(`name LIKE ?`); params.push(`%${keyword}%`); }
  const sql = `FROM script WHERE ${where.join(' AND ')}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${sql}`, params);
  const [rows] = await pool.query(
    `SELECT id, name, grade, roles ${sql} ORDER BY id LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size]);
  rows.forEach(r => { r.roles = typeof r.roles === 'string' ? JSON.parse(r.roles || '[]') : (r.roles || []); });
  res.json({ code: 0, data: { total, page, size, list: rows } });
}));

module.exports = router;
