// ============================================================
// 管理后台接口（仅超管，JWT role=admin，越权403）
// 多租户：超管登录后通过 X-Tenant 切换品牌；所有业务数据按 req.tenantId 隔离
// 品牌管理：/tenants 系列接口（列表/新建/改名/启停/主题/素材上传）
// ============================================================
const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { sign, auth } = require('../middleware/auth');
const { hash, verify } = require('../utils/hash');
const { invalidate } = require('../middleware/tenant');
const assignService = require('../services/assignService');
const salaryService = require('../services/salaryService');
const scheduleService = require('../services/scheduleService');

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e.code === 'CONFLICT') return res.status(400).json({ code: 400, msg: e.message });
  if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ code: 400, msg: '数据重复：该记录已存在' });
  console.error(e);
  res.status(500).json({ code: 500, msg: '服务异常，请稍后再试' });
});
const log = async (req, action, target) => {
  await pool.query(`INSERT INTO admin_log(tenant_id, admin_id, action, target) VALUES(?,?,?,?)`,
    [req.tenantId, req.user.id, action, String(target || '').slice(0, 200)]);
};

// ---------- 管理员登录（默认租户1；品牌管理员带 X-Tenant 登录） ----------
router.post('/login', wrap(async (req, res) => {
  const { staff_no, password } = req.body || {};
  const [rows] = await pool.query(
    `SELECT * FROM account WHERE staff_no=? AND role='admin' AND tenant_id=?`, [staff_no, req.tenantId]);
  if (!rows.length || !verify(password, rows[0].password_hash)) {
    return res.status(400).json({ code: 400, msg: '账号或密码错误' });
  }
  if (rows[0].status !== 'active') return res.status(403).json({ code: 403, msg: '账号已停用' });
  const token = sign({ id: rows[0].id, role: 'admin', name: rows[0].name, tenant_id: req.tenantId });
  res.json({ code: 0, data: { token, name: rows[0].name } });
}));

router.use(auth('admin'));

// ---------- 品牌/租户管理（OEM贴牌） ----------
// 品牌列表（含主题配置）
router.get('/tenants', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.id, t.code, t.name, t.status, t.created_at,
            th.logo, th.brand_name, th.colors, th.bg_image, th.bg_mode, th.bg_overlay
       FROM tenant t LEFT JOIN tenant_theme th ON th.tenant_id=t.id ORDER BY t.id`);
  rows.forEach(r => {
    try { r.colors = typeof r.colors === 'string' ? JSON.parse(r.colors) : (r.colors || {}); }
    catch (e) { r.colors = {}; }
  });
  res.json({ code: 0, data: rows });
}));

// 新建品牌：建租户 + 默认主题（复制当前红金）+ 独立设置
router.post('/tenants', wrap(async (req, res) => {
  const { code, name } = req.body || {};
  const c = String(code || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(c)) return res.status(400).json({ code: 400, msg: '租户码需为2~32位小写字母/数字/-/_' });
  if (!name) return res.status(400).json({ code: 400, msg: '品牌名称必填' });
  const [r] = await pool.query(`INSERT INTO tenant(code, name) VALUES(?,?)`, [c, name]);
  const [defTheme] = await pool.query(`SELECT * FROM tenant_theme WHERE tenant_id=1`);
  const dt = defTheme[0] || {};
  await pool.query(
    `INSERT INTO tenant_theme(tenant_id, brand_name, colors) VALUES(?,?,?)`,
    [r.insertId, name, typeof dt.colors === 'string' ? dt.colors : JSON.stringify(dt.colors || {})]);
  await pool.query(`INSERT IGNORE INTO settings(tenant_id) VALUES(?)`, [r.insertId]);
  invalidate();
  await log(req, '新建品牌', `${c} ${name}`);
  res.json({ code: 0, data: { id: r.insertId }, msg: '已创建品牌，可继续配置外观' });
}));

// 改名 / 启停
router.put('/tenants/:id', wrap(async (req, res) => {
  const { name, status } = req.body || {};
  if (+req.params.id === 1 && status === 'disabled') {
    return res.status(400).json({ code: 400, msg: '默认品牌不可停用' });
  }
  if (name) await pool.query(`UPDATE tenant SET name=? WHERE id=?`, [name, req.params.id]);
  if (status) await pool.query(`UPDATE tenant SET status=? WHERE id=?`, [status, req.params.id]);
  invalidate();
  await log(req, '更新品牌', req.params.id);
  res.json({ code: 0, msg: '已保存' });
}));

// 保存主题：品牌名/配色/背景图URL/适配模式/遮罩透明度
router.put('/tenants/:id/theme', wrap(async (req, res) => {
  const t = req.body || {};
  const colors = typeof t.colors === 'object' && t.colors ? t.colors : {};
  await pool.query(
    `INSERT INTO tenant_theme(tenant_id, logo, brand_name, colors, bg_image, bg_mode, bg_overlay)
     VALUES(?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE logo=VALUES(logo), brand_name=VALUES(brand_name), colors=VALUES(colors),
       bg_image=VALUES(bg_image), bg_mode=VALUES(bg_mode), bg_overlay=VALUES(bg_overlay)`,
    [req.params.id, t.logo || '', t.brandName || '', JSON.stringify(colors),
     t.bgImage || '', t.bgMode === 'contain' ? 'contain' : 'cover',
     Math.max(0, Math.min(1, +t.bgOverlay ?? 0.6))]);
  await log(req, '保存品牌主题', `tenant#${req.params.id}`);
  res.json({ code: 0, msg: '主题已保存，小程序端刷新即生效' });
}));

// 素材上传：base64 → /uploads/tenants/{id}/{logo|bg}_ts.ext（jpg/jpeg/png/webp，≤5MB）
router.post('/tenants/:id/asset', wrap(async (req, res) => {
  const { kind, base64 } = req.body || {};
  if (!['logo', 'bg'].includes(kind)) return res.status(400).json({ code: 400, msg: 'kind 仅支持 logo/bg' });
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(base64 || ''));
  if (!m || m[2].length > 7 * 1024 * 1024) {
    return res.status(400).json({ code: 400, msg: '仅支持png/jpg/webp，且不超过5MB' });
  }
  const ext = m[1] === 'png' ? 'png' : (m[1] === 'webp' ? 'webp' : 'jpg');
  const dir = path.join(__dirname, '../../uploads/tenants', String(req.params.id));
  fs.mkdirSync(dir, { recursive: true });
  const name = `${kind}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'));
  const url = `/uploads/tenants/${req.params.id}/${name}`;
  await pool.query(
    `INSERT INTO tenant_theme(tenant_id, ${kind === 'logo' ? 'logo' : 'bg_image'}) VALUES(?,?)
     ON DUPLICATE KEY UPDATE ${kind === 'logo' ? 'logo' : 'bg_image'}=VALUES(${kind === 'logo' ? 'logo' : 'bg_image'})`,
    [req.params.id, url]);
  await log(req, '上传品牌素材', `tenant#${req.params.id} ${kind}`);
  res.json({ code: 0, data: { url }, msg: '已上传' });
}));

// ---------- 总览 ----------
router.get('/dashboard', wrap(async (req, res) => {
  const tid = req.tenantId;
  const [[s7]] = await pool.query(
    `SELECT COUNT(*) n FROM session WHERE tenant_id=? AND status<>'cancelled' AND work_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)`, [tid]);
  const [[bk]] = await pool.query(`SELECT COUNT(*) n FROM booking WHERE tenant_id=? AND status='locked'`, [tid]);
  const [[fill]] = await pool.query(
    `SELECT COALESCE(SUM(s.required_dm),0) req, COUNT(sd.id) got
       FROM session s LEFT JOIN session_dm sd ON sd.session_id=s.id AND sd.tenant_id=s.tenant_id
      WHERE s.tenant_id=? AND s.work_date>=CURDATE() AND s.status<>'cancelled'`, [tid]);
  const [[warn]] = await pool.query(`SELECT COUNT(*) n FROM session WHERE tenant_id=? AND warn=1 AND status='open'`, [tid]);
  const _n = new Date();
  const month = `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}`; // 本地时区，UTC会在月初错取上月
  const [[sal]] = await pool.query(
    `SELECT COALESCE(SUM(payable),0) s, COUNT(*) n FROM salary_record WHERE tenant_id=? AND month=?`, [tid, month]);
  const [warnList] = await pool.query(
    `SELECT s.id, s.work_date, s.slot, s.required_dm, sc.name AS script_name,
            (SELECT COUNT(*) FROM session_dm sd WHERE sd.session_id=s.id AND sd.tenant_id=s.tenant_id) assigned
       FROM session s JOIN script sc ON sc.id=s.script_id
      WHERE s.tenant_id=? AND s.warn=1 AND s.status='open' AND s.work_date>=CURDATE() ORDER BY s.work_date LIMIT 20`, [tid]);
  res.json({ code: 0, data: {
    sessions7: s7.n, bookings: bk.n, fill: { req: +fill.req, got: +fill.got },
    warns: warn.n, salaryMonth: month, salarySum: +sal.s, salaryCount: sal.n, warnList
  } });
}));

// 手动触发自动补位（当前品牌）
router.post('/autofill', wrap(async (req, res) => {
  res.json({ code: 0, data: await scheduleService.autoFill(req.tenantId), msg: '自动补位已执行' });
}));

// ---------- 员工账号 ----------
router.get('/accounts', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.id, a.staff_no, a.name, a.phone, a.role, a.status, a.created_at,
            d.id dm_id, d.stage_name, d.photo, d.tags, d.intro, d.status dm_status, d.base_salary
       FROM account a LEFT JOIN dm d ON d.account_id=a.id
      WHERE a.tenant_id=? ORDER BY a.role, a.staff_no`, [req.tenantId]);
  res.json({ code: 0, data: rows });
}));

// 开号：员工编号1~30，可选同时建DM档案
router.post('/accounts', wrap(async (req, res) => {
  const { staff_no, name, phone, password, create_dm, base_salary, stage_name } = req.body || {};
  if (!name || !password) return res.status(400).json({ code: 400, msg: '姓名和密码必填' });
  if (staff_no != null && staff_no !== '' && !(+staff_no >= 1 && +staff_no <= 30)) {
    return res.status(400).json({ code: 400, msg: '员工编号必须在1~30之间' });
  }
  const [r] = await pool.query(
    `INSERT INTO account(tenant_id, staff_no, name, phone, password_hash, role) VALUES(?,?,?,?,?, 'staff')`,
    [req.tenantId, staff_no === '' ? null : +staff_no, name, phone || '', hash(password)]);
  if (create_dm) {
    await pool.query(
      `INSERT INTO dm(tenant_id, account_id, stage_name, base_salary) VALUES(?,?,?,?)`,
      [req.tenantId, r.insertId, stage_name || name, +base_salary || 0]);
  }
  await log(req, '创建员工账号', `${staff_no || '-'} ${name}`);
  res.json({ code: 0, msg: '已开通' });
}));

// 停用/启用、重置密码
router.put('/accounts/:id', wrap(async (req, res) => {
  const { status, password, phone, name } = req.body || {};
  if (status) await pool.query(`UPDATE account SET status=? WHERE id=? AND role='staff' AND tenant_id=?`, [status, req.params.id, req.tenantId]);
  if (password) await pool.query(`UPDATE account SET password_hash=? WHERE id=? AND tenant_id=?`, [hash(password), req.params.id, req.tenantId]);
  if (phone != null) await pool.query(`UPDATE account SET phone=? WHERE id=? AND tenant_id=?`, [phone, req.params.id, req.tenantId]);
  if (name) await pool.query(`UPDATE account SET name=? WHERE id=? AND tenant_id=?`, [name, req.params.id, req.tenantId]);
  await log(req, '更新员工账号', req.params.id);
  res.json({ code: 0, msg: '已保存' });
}));

// ---------- 小程序用户（每个客户微信登录即建档，可升级为DM） ----------
router.get('/users', wrap(async (req, res) => {
  const { keyword = '', role = '' } = req.query;
  const page = Math.max(1, +req.query.page || 1), size = Math.min(100, +req.query.size || 20);
  const where = ['u.tenant_id=?'], params = [req.tenantId];
  if (keyword) {
    where.push('(u.nickname LIKE ? OR u.phone LIKE ? OR u.openid LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (role) { where.push('u.role=?'); params.push(role); }
  const sql = `FROM user u LEFT JOIN dm d ON d.user_id=u.id WHERE ${where.join(' AND ')}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${sql}`, params);
  const [rows] = await pool.query(
    `SELECT u.id, u.openid, u.nickname, u.avatar, u.phone, u.role, u.status, u.created_at,
            d.id dm_id, d.stage_name, d.status dm_status ${sql}
      ORDER BY u.id DESC LIMIT ? OFFSET ?`, [...params, size, (page - 1) * size]);
  res.json({ code: 0, data: { total, page, size, list: rows } });
}));

// 设为DM：创建/激活DM档案并绑定用户；其小程序端立即出现DM工作台（排班/薪资/提成表）
router.post('/users/:id/set-dm', wrap(async (req, res) => {
  const { stage_name, base_salary, tags } = req.body || {};
  const [[u]] = await pool.query(`SELECT * FROM user WHERE id=? AND tenant_id=?`, [req.params.id, req.tenantId]);
  if (!u) return res.status(404).json({ code: 404, msg: '用户不存在' });
  if (u.status === 'banned') return res.status(400).json({ code: 400, msg: '该账号已被封禁，请先解封' });
  const [exist] = await pool.query(`SELECT * FROM dm WHERE user_id=?`, [u.id]);
  if (exist.length) { // 曾是DM：重新激活，花名留空则沿用原花名
    await pool.query(
      `UPDATE dm SET status='active', stage_name=COALESCE(NULLIF(?,''), stage_name),
         tags=COALESCE(NULLIF(?,''), tags), base_salary=COALESCE(NULLIF(?,''), base_salary) WHERE id=?`,
      [stage_name || '', tags || '', base_salary != null && +base_salary >= 0 ? +base_salary : null, exist[0].id]);
  } else {
    await pool.query(`INSERT INTO dm(tenant_id, user_id, stage_name, tags, base_salary) VALUES(?,?,?,?,?)`,
      [req.tenantId, u.id, stage_name || u.nickname || 'DM', tags || '', +base_salary || 0]);
  }
  await pool.query(`UPDATE user SET role='dm' WHERE id=?`, [u.id]);
  await log(req, '设为DM', `user#${u.id} ${u.nickname}`);
  res.json({ code: 0, msg: '已设为DM，该用户小程序「我的」页将出现DM工作台' });
}));

// 撤销DM：DM档案离岗（保留历史排班与薪资），用户回到普通玩家
router.post('/users/:id/unset-dm', wrap(async (req, res) => {
  await pool.query(`UPDATE dm SET status='inactive' WHERE user_id=? AND tenant_id=?`, [req.params.id, req.tenantId]);
  await pool.query(`UPDATE user SET role='player' WHERE id=? AND tenant_id=?`, [req.params.id, req.tenantId]);
  await log(req, '撤销DM', `user#${req.params.id}`);
  res.json({ code: 0, msg: '已撤销DM身份' });
}));

// 编辑用户（电话/封禁）
router.put('/users/:id', wrap(async (req, res) => {
  const { phone, status } = req.body || {};
  if (phone != null) await pool.query(`UPDATE user SET phone=? WHERE id=? AND tenant_id=?`, [phone, req.params.id, req.tenantId]);
  if (status) await pool.query(`UPDATE user SET status=? WHERE id=? AND tenant_id=?`, [status, req.params.id, req.tenantId]);
  await log(req, '更新小程序用户', req.params.id);
  res.json({ code: 0, msg: '已保存' });
}));

// ---------- DM档案（保密底薪仅管理员可读写） ----------
router.get('/dms', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.*, a.staff_no, a.name account_name, a.phone account_phone,
            u.nickname user_nickname, u.avatar user_avatar, u.phone user_phone
       FROM dm d
       LEFT JOIN account a ON a.id=d.account_id
       LEFT JOIN user u ON u.id=d.user_id
      WHERE d.tenant_id=? ORDER BY d.id`, [req.tenantId]);
  res.json({ code: 0, data: rows });
}));
router.post('/dms', wrap(async (req, res) => {
  const { account_id, stage_name, photo, tags, intro, base_salary } = req.body || {};
  if (!stage_name) return res.status(400).json({ code: 400, msg: '花名必填' });
  const [r] = await pool.query(
    `INSERT INTO dm(tenant_id, account_id, stage_name, photo, tags, intro, base_salary) VALUES(?,?,?,?,?,?,?)`,
    [req.tenantId, account_id || null, stage_name, photo || '', tags || '', intro || '', +base_salary || 0]);
  await log(req, '新建DM档案', stage_name);
  res.json({ code: 0, data: { id: r.insertId } });
}));
router.put('/dms/:id', wrap(async (req, res) => {
  const d = req.body || {};
  await pool.query(
    `UPDATE dm SET stage_name=?, photo=?, tags=?, intro=?, status=?, base_salary=? WHERE id=? AND tenant_id=?`,
    [d.stage_name, d.photo || '', d.tags || '', d.intro || '', d.status || 'active', +d.base_salary || 0, req.params.id, req.tenantId]);
  await log(req, '更新DM档案', req.params.id);
  res.json({ code: 0, msg: '已保存' });
}));

// ---------- DM技能矩阵 ----------
router.get('/skills', wrap(async (req, res) => {
  const dmId = +req.query.dm_id || 0;
  const [rows] = await pool.query(
    `SELECT sk.id, sk.dm_id, sk.role_name, sk.proficiency, sk.script_id, sc.name AS script_name
       FROM dm_skill sk JOIN script sc ON sc.id=sk.script_id
      WHERE sk.dm_id=? AND sk.tenant_id=? ORDER BY sk.script_id`, [dmId, req.tenantId]);
  res.json({ code: 0, data: rows });
}));
router.post('/skills', wrap(async (req, res) => {
  const { dm_id, script_id, role_name, proficiency } = req.body || {};
  if (!dm_id || !script_id) return res.status(400).json({ code: 400, msg: '参数缺失' });
  await pool.query(
    `INSERT INTO dm_skill(tenant_id, dm_id, script_id, role_name, proficiency) VALUES(?,?,?,?,?)
     ON DUPLICATE KEY UPDATE role_name=VALUES(role_name), proficiency=VALUES(proficiency)`,
    [req.tenantId, dm_id, script_id, role_name || '', +proficiency || 3]);
  res.json({ code: 0, msg: '已保存' });
}));
router.delete('/skills/:id', wrap(async (req, res) => {
  await pool.query(`DELETE FROM dm_skill WHERE id=? AND tenant_id=?`, [req.params.id, req.tenantId]);
  res.json({ code: 0, msg: '已删除' });
}));

// ---------- 剧本管理 ----------
router.get('/scripts', wrap(async (req, res) => {
  const { keyword = '', grade = '', status = '' } = req.query;
  const page = Math.max(1, +req.query.page || 1), size = Math.min(100, +req.query.size || 20);
  const where = ['tenant_id=?'], params = [req.tenantId];
  if (keyword) { where.push('name LIKE ?'); params.push(`%${keyword}%`); }
  if (grade) { where.push('grade=?'); params.push(grade); }
  if (status) { where.push('status=?'); params.push(status); }
  const sql = `FROM script WHERE ${where.join(' AND ')}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${sql}`, params);
  const [rows] = await pool.query(`SELECT * ${sql} ORDER BY id LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size]);
  rows.forEach(r => { r.roles = typeof r.roles === 'string' ? JSON.parse(r.roles || '[]') : (r.roles || []); });
  res.json({ code: 0, data: { total, page, size, list: rows } });
}));
router.post('/scripts', wrap(async (req, res) => {
  const s = req.body || {};
  const [r] = await pool.query(
    `INSERT INTO script(tenant_id, name, cover, type, players_min, players_max, duration_min, price, grade, intro, roles, status)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [req.tenantId, s.name, s.cover || '', s.type || '推理', +s.players_min || 4, +s.players_max || 8,
     +s.duration_min || 240, +s.price || 0, s.grade || '12+', s.intro || '',
     JSON.stringify(s.roles || []), s.status || 'on']);
  await log(req, '新建剧本', s.name);
  res.json({ code: 0, data: { id: r.insertId } });
}));
router.put('/scripts/:id', wrap(async (req, res) => {
  const s = req.body || {};
  await pool.query(
    `UPDATE script SET name=?, type=?, players_min=?, players_max=?, duration_min=?, price=?,
       grade=?, intro=?, roles=?, status=? WHERE id=? AND tenant_id=?`,
    [s.name, s.type, +s.players_min, +s.players_max, +s.duration_min, +s.price,
     s.grade, s.intro || '', JSON.stringify(s.roles || []), s.status, req.params.id, req.tenantId]);
  await log(req, '更新剧本', `${req.params.id} ${s.name}`);
  res.json({ code: 0, msg: '已保存' });
}));

// ---------- 场次排班（核心） ----------
router.get('/sessions', wrap(async (req, res) => {
  const { date = '', slot = '' } = req.query;
  const where = ['s.tenant_id=?'], params = [req.tenantId];
  if (date) { where.push('s.work_date=?'); params.push(date); }
  else { where.push('s.work_date>=DATE_SUB(CURDATE(), INTERVAL 7 DAY)'); }
  if (slot) { where.push('s.slot=?'); params.push(slot); }
  const [rows] = await pool.query(
    `SELECT s.*, sc.name AS script_name, sc.grade, sc.price
       FROM session s JOIN script sc ON sc.id=s.script_id
      WHERE ${where.join(' AND ')} ORDER BY s.work_date DESC, s.slot, s.id LIMIT 200`, params);
  const ids = rows.map(r => r.id);
  let dmMap = {};
  if (ids.length) {
    const [dms] = await pool.query(
      `SELECT sd.*, d.stage_name, d.photo FROM session_dm sd JOIN dm d ON d.id=sd.dm_id
        WHERE sd.tenant_id=? AND sd.session_id IN (${ids.map(() => '?').join(',')})`, [req.tenantId, ...ids]);
    dms.forEach(d => { (dmMap[d.session_id] = dmMap[d.session_id] || []).push(d); });
  }
  rows.forEach(r => { r.dms = dmMap[r.id] || []; });
  res.json({ code: 0, data: rows });
}));

// 建场：按日期+午/晚场+剧本，开场时间与所需DM数取当前品牌设置
router.post('/sessions', wrap(async (req, res) => {
  const { work_date, slot, script_id } = req.body || {};
  if (!work_date || !slot || !script_id) return res.status(400).json({ code: 400, msg: '参数缺失' });
  await pool.query(`INSERT IGNORE INTO settings(tenant_id) VALUES(?)`, [req.tenantId]);
  const [[st]] = await pool.query(`SELECT * FROM settings WHERE tenant_id=?`, [req.tenantId]);
  const [sc] = await pool.query(`SELECT id FROM script WHERE id=? AND tenant_id=? AND status='on'`, [script_id, req.tenantId]);
  if (!sc.length) return res.status(400).json({ code: 400, msg: '剧本不存在或已下架' });
  await pool.query(
    `INSERT INTO session(tenant_id, work_date, slot, script_id, start_time, required_dm)
     VALUES(?,?,?,?,?,?)`,
    [req.tenantId, work_date, slot, script_id, slot === 'noon' ? st.noon_start : st.night_start, st.dm_per_session]);
  await log(req, '建场', `${work_date} ${slot} script#${script_id}`);
  res.json({ code: 0, msg: '已建场' });
}));

// 手动排DM（指定角色可选）
router.post('/sessions/:id/assign', wrap(async (req, res) => {
  await assignService.manualAssign({
    sessionId: +req.params.id, dmId: +req.body.dm_id,
    roleName: req.body.role_name || '', source: 'manual', tenantId: req.tenantId
  });
  await log(req, '手动排DM', `session#${req.params.id} dm#${req.body.dm_id}`);
  res.json({ code: 0, msg: '已排入' });
}));

// 换人（先校验再换占用并重算薪资，事务内）
router.post('/sessions/:id/swap', wrap(async (req, res) => {
  await assignService.swapDm({
    sessionId: +req.params.id, fromDm: +req.body.from_dm, toDm: +req.body.to_dm,
    roleName: req.body.role_name || '', tenantId: req.tenantId
  });
  await log(req, '换人', `session#${req.params.id} ${req.body.from_dm}->${req.body.to_dm}`);
  res.json({ code: 0, msg: '已换人并重算薪资' });
}));

router.post('/sessions/:id/remove', wrap(async (req, res) => {
  await assignService.removeDm({ sessionId: +req.params.id, dmId: +req.body.dm_id, tenantId: req.tenantId });
  await log(req, '移除DM', `session#${req.params.id} dm#${req.body.dm_id}`);
  res.json({ code: 0, msg: '已移除并释放时段' });
}));

router.post('/sessions/:id/cancel', wrap(async (req, res) => {
  await assignService.cancelSession(+req.params.id, req.tenantId);
  await log(req, '取消场次', req.params.id);
  res.json({ code: 0, msg: '场次已取消，占用已释放' });
}));

// 候选DM列表：显示该日期时段的占用状态（前端置灰busy/leave），标注是否匹配剧本技能
router.get('/dms/free', wrap(async (req, res) => {
  const { date, slot, script_id, exclude_session } = req.query;
  const [rows] = await pool.query(
    `SELECT d.id, d.stage_name, d.photo,
            COALESCE(a.status,'free') AS av,
            EXISTS(SELECT 1 FROM dm_skill sk WHERE sk.dm_id=d.id AND sk.script_id=? AND sk.tenant_id=?) AS has_skill
       FROM dm d
       LEFT JOIN availability a ON a.dm_id=d.id AND a.tenant_id=? AND a.work_date=? AND a.slot=?
      WHERE d.status='active' AND d.tenant_id=?
        AND d.id NOT IN (SELECT dm_id FROM session_dm WHERE session_id=? AND tenant_id=?)
      ORDER BY has_skill DESC, d.id`,
    [+script_id || 0, req.tenantId, req.tenantId, date, slot, req.tenantId, +exclude_session || 0, req.tenantId]);
  res.json({ code: 0, data: rows });
}));

// ---------- 请假登记 ----------
router.get('/leaves', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT l.*, d.stage_name FROM leave_record l JOIN dm d ON d.id=l.dm_id
      WHERE l.tenant_id=? AND l.work_date>=DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      ORDER BY l.work_date, l.id DESC LIMIT 100`, [req.tenantId]);
  res.json({ code: 0, data: rows });
}));
router.post('/leaves', wrap(async (req, res) => {
  const { dm_id, work_date, reason } = req.body || {};
  const slot = ['noon', 'night', 'all'].includes(req.body.slot) ? req.body.slot : 'all';
  if (!dm_id || !work_date) return res.status(400).json({ code: 400, msg: '请选择DM和日期' });
  const slots = slot === 'all' ? ['noon', 'night'] : [slot];
  for (const s of slots) {
    const [a] = await pool.query(
      `SELECT status FROM availability WHERE tenant_id=? AND dm_id=? AND work_date=? AND slot=?`,
      [req.tenantId, dm_id, work_date, s]);
    if (a.length && a[0].status === 'busy') {
      return res.status(400).json({ code: 400, msg: `该DM在${s === 'noon' ? '午场' : '晚场'}已有排班，请先换人再登记请假` });
    }
    await pool.query(
      `INSERT INTO availability(tenant_id, dm_id, work_date, slot, status) VALUES(?,?,?,?,'leave')
       ON DUPLICATE KEY UPDATE status='leave'`, [req.tenantId, dm_id, work_date, s]);
  }
  await pool.query(`INSERT INTO leave_record(tenant_id, dm_id, work_date, slot, reason) VALUES(?,?,?,?,?)`,
    [req.tenantId, dm_id, work_date, slot, reason || '']);
  await log(req, '请假登记', `dm#${dm_id} ${work_date} ${slot}`);
  res.json({ code: 0, msg: '已登记请假' });
}));
router.delete('/leaves/:id', wrap(async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM leave_record WHERE id=? AND tenant_id=?`, [req.params.id, req.tenantId]);
  if (rows.length) {
    const l = rows[0];
    const slots = l.slot === 'all' ? ['noon', 'night'] : [l.slot];
    for (const s of slots) {
      await pool.query(
        `UPDATE availability SET status='free' WHERE tenant_id=? AND dm_id=? AND work_date=? AND slot=? AND status='leave'`,
        [req.tenantId, l.dm_id, l.work_date, s]);
    }
    await pool.query(`DELETE FROM leave_record WHERE id=?`, [l.id]);
  }
  res.json({ code: 0, msg: '已撤销请假' });
}));

// ---------- 薪资（仅管理员可见全部） ----------
router.get('/salary', wrap(async (req, res) => {
  const _n = new Date();
  const month = req.query.month || `${_n.getFullYear()}-${String(_n.getMonth() + 1).padStart(2, '0')}`; // 本地时区月份
  const [dms] = await pool.query(
    `SELECT d.id, d.stage_name, d.base_salary, a.staff_no, d.status
       FROM dm d LEFT JOIN account a ON a.id=d.account_id
      WHERE d.status='active' AND d.tenant_id=? ORDER BY a.staff_no`, [req.tenantId]);
  for (const d of dms) await salaryService.recalcMonth(pool, d.id, month, req.tenantId);
  const [rows] = await pool.query(
    `SELECT * FROM salary_record WHERE tenant_id=? AND month=?`, [req.tenantId, month]);
  const map = {}; rows.forEach(r => map[r.dm_id] = r);
  const out = dms.map(d => {
    const r = map[d.id] || {};
    let detail = r.detail;
    detail = typeof detail === 'string' ? JSON.parse(detail || '[]') : (detail || []);
    return {
      dm_id: d.id, staff_no: d.staff_no, stage_name: d.stage_name,
      base_salary: +d.base_salary,
      commission: +(r.commission || 0), bonus: +(r.bonus || 0),
      deduction: +(r.deduction || 0), payable: +(r.payable || 0),
      sessions: detail.length, detail
    };
  });
  res.json({ code: 0, data: { month, list: out } });
}));
router.put('/salary/:dmId', wrap(async (req, res) => {
  const month = req.body.month, deduction = +req.body.deduction || 0;
  await pool.query(
    `INSERT INTO salary_record(tenant_id, dm_id, month, deduction) VALUES(?,?,?,?)
     ON DUPLICATE KEY UPDATE deduction=VALUES(deduction)`, [req.tenantId, req.params.dmId, month, deduction]);
  await salaryService.recalcMonth(pool, +req.params.dmId, month, req.tenantId); // 重算应发
  await log(req, '调整扣除项', `dm#${req.params.dmId} ${month} -${deduction}`);
  res.json({ code: 0, msg: '已更新并重算' });
}));

// ---------- 会员卡（只管理员加，系统扣，流水留痕） ----------
router.get('/cards', wrap(async (req, res) => {
  const kw = `%${req.query.keyword || ''}%`;
  const [rows] = await pool.query(
    `SELECT * FROM member_card WHERE tenant_id=? AND openid LIKE ? ORDER BY id DESC LIMIT 50`, [req.tenantId, kw]);
  res.json({ code: 0, data: rows });
}));
router.post('/cards/recharge', wrap(async (req, res) => {
  const { openid, amount, remark } = req.body || {};
  const amt = +amount;
  if (!openid || !(amt > 0)) return res.status(400).json({ code: 400, msg: '参数错误' });
  await pool.query(`INSERT INTO member_card(tenant_id, openid, balance) VALUES(?,?, 0) ON DUPLICATE KEY UPDATE balance=balance`,
    [req.tenantId, openid]);
  await pool.query(`UPDATE member_card SET balance=balance+? WHERE tenant_id=? AND openid=?`, [amt, req.tenantId, openid]);
  await pool.query(
    `INSERT INTO card_flow(tenant_id, openid, type, amount, remark, operator) VALUES(?,?,?,?,?,?)`,
    [req.tenantId, openid, 'recharge', amt, remark || '管理员充值', req.user.name]);
  await log(req, '会员卡充值', `${openid} +${amt}`);
  res.json({ code: 0, msg: '已充值' });
}));
router.post('/cards/coupon', wrap(async (req, res) => {
  const { openid, name, value } = req.body || {};
  if (!openid) return res.status(400).json({ code: 400, msg: '参数错误' });
  await pool.query(`INSERT INTO coupon(tenant_id, openid, name, value) VALUES(?,?,?,?)`,
    [req.tenantId, openid, name || '优惠券', +value || 0]);
  await pool.query(
    `INSERT INTO card_flow(tenant_id, openid, type, amount, remark, operator) VALUES(?,?,?,?,?,?)`,
    [req.tenantId, openid, 'issue', +value || 0, `发放券：${name || '优惠券'}`, req.user.name]);
  await log(req, '发券', `${openid} ${name} ${value}`);
  res.json({ code: 0, msg: '已发券' });
}));
router.get('/flows', wrap(async (req, res) => {
  const kw = `%${req.query.keyword || ''}%`;
  const [rows] = await pool.query(
    `SELECT * FROM card_flow WHERE tenant_id=? AND openid LIKE ? ORDER BY id DESC LIMIT 100`, [req.tenantId, kw]);
  res.json({ code: 0, data: rows });
}));

// ---------- 设置（按租户） ----------
router.get('/settings', wrap(async (req, res) => {
  await pool.query(`INSERT IGNORE INTO settings(tenant_id) VALUES(?)`, [req.tenantId]);
  const [rows] = await pool.query(`SELECT * FROM settings WHERE tenant_id=?`, [req.tenantId]);
  const s = rows[0] || {};
  s.bonus_ladder = typeof s.bonus_ladder === 'string' ? JSON.parse(s.bonus_ladder || '[]') : (s.bonus_ladder || []);
  res.json({ code: 0, data: s });
}));
router.put('/settings', wrap(async (req, res) => {
  const s = req.body || {};
  await pool.query(
    `INSERT INTO settings(tenant_id, noon_start, night_start, dm_per_session, bonus_ladder, phone, wechat, address, lat, lng)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE noon_start=VALUES(noon_start), night_start=VALUES(night_start),
       dm_per_session=VALUES(dm_per_session), bonus_ladder=VALUES(bonus_ladder), phone=VALUES(phone),
       wechat=VALUES(wechat), address=VALUES(address), lat=VALUES(lat), lng=VALUES(lng)`,
    [req.tenantId, s.noon_start, s.night_start, +s.dm_per_session || 3,
     JSON.stringify(Array.isArray(s.bonus_ladder) ? s.bonus_ladder : []),
     s.phone || '', s.wechat || '', s.address || '', +s.lat || 0, +s.lng || 0]);
  await log(req, '修改系统设置', '');
  res.json({ code: 0, msg: '已保存' });
}));

// ---------- 操作日志（按当前品牌） ----------
router.get('/logs', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT l.*, a.name admin_name FROM admin_log l LEFT JOIN account a ON a.id=l.admin_id
      WHERE l.tenant_id=? ORDER BY l.id DESC LIMIT 100`, [req.tenantId]);
  res.json({ code: 0, data: rows });
}));

module.exports = router;
